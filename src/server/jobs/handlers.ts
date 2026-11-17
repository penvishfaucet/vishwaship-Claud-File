import { and, eq, inArray, lte, lt } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { audit } from "@/server/audit";
import { withLedger } from "@/server/ledger/db-store";
import { release, settle } from "@/server/ledger/wallet";
import { getAdapter, providerContext } from "@/server/providers/registry";
import { decrypt, hmacSha256Hex } from "@/server/security/crypto";
import { safeFetch } from "@/server/security/safe-fetch";
import { newId } from "@/server/util/ids";
import { type JobResult, enqueue, registerHandler } from "./runner";

/**
 * booking.reconcile — an ambiguous or async booking. Ask the provider whether the booking exists
 * BEFORE any retry/rebook. Confirmed -> persist + settle once. Definitely absent -> release hold.
 * Still unknown -> back off. Never invents an AWB.
 */
registerHandler("booking.reconcile", async (p, attempt): Promise<JobResult> => {
  const { orderId, quoteId, reservationId } = p as { orderId: string; quoteId: string; reservationId: string };
  const db = await getDb();
  const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
  const [quote] = await db.select().from(schema.quotes).where(eq(schema.quotes.id, quoteId));
  if (!order || !quote) return { dead: "order or quote missing" };
  const [wallet] = await db.select().from(schema.wallets).where(eq(schema.wallets.orgId, order.orgId));
  const [acct] = await db.select().from(schema.providerAccounts).where(eq(schema.providerAccounts.id, quote.providerAccountId!));
  const ad = acct && getAdapter(acct.adapter);
  if (!ad) return { dead: "adapter unavailable" };
  const r = await ad.lookupBooking(await providerContext(acct), { vishwashipOrderId: orderId });
  if (!r.ok) return { retryInSec: Math.min(3600, 60 * 2 ** attempt), error: r.error.message };
  const [existing] = await db.select().from(schema.shipments).where(eq(schema.shipments.orderId, orderId));
  if (r.value && r.value.state === "confirmed") {
    const priced = quote.priced as { carrierName: string; costPreTax: number; chargeableWeightGrams: number };
    const shipmentId = existing?.id ?? newId("shp");
    if (existing) {
      await db.update(schema.shipments).set({ bookingStatus: "confirmed", awb: r.value.awb ?? existing.awb, lrNumber: r.value.lrNumber ?? existing.lrNumber }).where(eq(schema.shipments.id, existing.id));
    } else {
      await db.insert(schema.shipments).values({
        id: shipmentId, orgId: order.orgId, orderId, providerAccountId: acct.id, provider: acct.adapter, carrierCode: quote.carrierCode, carrierName: priced.carrierName,
        serviceName: quote.serviceName, providerOrderRef: r.value.providerOrderRef, awb: r.value.awb, lrNumber: r.value.lrNumber ?? null, bookingStatus: "confirmed",
        status: "booked", quoteId, sellPaise: quote.totalPaise, costPaise: priced.costPreTax, reservationId, chargeableWeightGrams: priced.chargeableWeightGrams,
      });
    }
    await withLedger((s) => settle(s, { walletId: wallet.id, reservationId, idempotencyKey: `settle:${reservationId}`, refType: "shipment", refId: shipmentId, memo: `Shipping charge ${order.orderNumber} (reconciled)` }));
    await db.update(schema.orders).set({ status: "booked" }).where(eq(schema.orders.id, orderId));
    await audit({ actorKind: "system", orgId: order.orgId, action: "booking.reconciled_confirmed", targetType: "order", targetId: orderId });
    return { done: true };
  }
  if (r.value === null) {
    if (existing) return { dead: "shipment exists but provider reports none — manual review" };
    await withLedger((s) => release(s, { walletId: wallet.id, reservationId, idempotencyKey: `release:${reservationId}`, refType: "order", refId: orderId, memo: `Released: ${order.orderNumber} not booked (reconciled)` }));
    await db.update(schema.orders).set({ status: "booking_failed" }).where(eq(schema.orders.id, orderId));
    await audit({ actorKind: "system", orgId: order.orgId, action: "booking.reconciled_absent", targetType: "order", targetId: orderId });
    return { done: true };
  }
  return { retryInSec: Math.min(3600, 60 * 2 ** attempt), error: "provider still processing" };
});

/**
 * cod.send — WhatsApp COD confirmation. Requires an enabled WATI account and credits. If either is
 * missing the confirmation goes to the exception queue (send_failed / no credit); the order stays
 * on hold and is NEVER auto-confirmed.
 */
registerHandler("cod.send", async (p): Promise<JobResult> => {
  const { orderId } = p as { orderId: string };
  const db = await getDb();
  const [c] = await db.select().from(schema.codConfirmations).where(eq(schema.codConfirmations.orderId, orderId));
  if (!c || c.status !== "pending" || c.sentAt) return { done: true };
  const [wati] = await db.select().from(schema.providerAccounts).where(and(eq(schema.providerAccounts.adapter, "wati"), eq(schema.providerAccounts.status, "enabled")));
  const [bal] = await db.select().from(schema.creditBalances).where(eq(schema.creditBalances.orgId, c.orgId));
  const reason = !wati ? "WhatsApp provider not configured" : (bal?.credits ?? 0) < 2 ? "Insufficient notification credits" : null;
  if (reason) {
    await db.update(schema.codConfirmations).set({ status: "send_failed" }).where(eq(schema.codConfirmations.id, c.id));
    await db.insert(schema.inAppAlerts).values({ id: newId("al"), orgId: c.orgId, kind: "cod", title: `COD confirmation not sent: ${reason}. Order is on hold.`, href: "/portal/notifications/cod/?status=send_failed" });
    await audit({ actorKind: "system", orgId: c.orgId, action: "cod.send_failed", targetType: "order", targetId: orderId, details: { reason } });
    return { done: true };
  }
  // WATI template send goes here once the account, sender and approved template are provided.
  return { dead: "WATI sending not implemented yet" };
});

/** webhook.retry — retry failed customer webhook deliveries with backoff (max 6 attempts). */
registerHandler("webhook.retry", async (): Promise<JobResult> => {
  const db = await getDb();
  const due = await db.select({ d: schema.webhookDeliveries, e: schema.webhookEndpoints }).from(schema.webhookDeliveries)
    .innerJoin(schema.webhookEndpoints, eq(schema.webhookEndpoints.id, schema.webhookDeliveries.endpointId))
    .where(and(eq(schema.webhookDeliveries.status, "failed"), lte(schema.webhookDeliveries.nextAttemptAt, new Date()), lt(schema.webhookDeliveries.attempts, 6))).limit(50);
  for (const { d, e } of due) {
    const body = JSON.stringify(d.payload);
    const ts = Math.floor(Date.now() / 1000).toString();
    let code = 0;
    try {
      const r = await safeFetch(e.url, { method: "POST", timeoutMs: 10_000, headers: { "content-type": "application/json", "x-vishwaship-event-id": d.eventId, "x-vishwaship-timestamp": ts, "x-vishwaship-signature": hmacSha256Hex(decrypt(e.secretEnc), `${ts}.${body}`) }, body });
      code = r.status;
    } catch { code = 0; }
    const ok = code >= 200 && code < 300, attempts = d.attempts + 1;
    await db.update(schema.webhookDeliveries).set({ status: ok ? "delivered" : attempts >= 6 ? "dead" : "failed", attempts, lastStatusCode: code || null, nextAttemptAt: ok ? null : new Date(Date.now() + 60_000 * 2 ** attempts) }).where(eq(schema.webhookDeliveries.id, d.id));
  }
  return { done: true };
});

/** Periodic sweeps: re-arm the webhook retry job and expire stale COD confirmations. */
export async function scheduleSweeps() {
  const minute = Math.floor(Date.now() / 60_000);
  await enqueue("webhook.retry", {}, { dedupeKey: `webhook.retry:${minute}` });
  const db = await getDb();
  await db.update(schema.codConfirmations).set({ status: "needs_review" })
    .where(and(inArray(schema.codConfirmations.status, ["pending"]), lte(schema.codConfirmations.expiresAt, new Date())));
}
