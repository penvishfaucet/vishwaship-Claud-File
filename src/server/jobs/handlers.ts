import { and, eq, inArray, lte, lt } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { audit } from "@/server/audit";
import { hasFeature } from "@/server/features";
import { withLedger } from "@/server/ledger/db-store";
import { release, settle } from "@/server/ledger/wallet";
import { getAdapter, providerContext } from "@/server/providers/registry";
import { decrypt, hmacSha256Hex } from "@/server/security/crypto";
import { safeFetch } from "@/server/security/safe-fetch";
import { newId } from "@/server/util/ids";
import { codSendFailed, giveUp, runCarrierCancellation, sendCodConfirmation, sendOutForDelivery, sweepNoResponse } from "@/server/whatsapp/service";
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
 * cod.send — WhatsApp COD confirmation (order stays on hold until the buyer answers or the admin timeout runs).
 * whatsapp.send — Out for Delivery message. cod.cancel — carrier cancellation after a buyer "Cancel Order".
 * All three are idempotent: message rows dedupe on their key, credits charge once per message,
 * decisions apply once, refunds use a fixed ledger idempotency key.
 */
registerHandler("cod.send", async (p, attempt): Promise<JobResult> => {
  const { orderId } = p as { orderId: string };
  const r = await sendCodConfirmation(orderId);
  if (r.retryable) {
    if (attempt < 5) return { retryInSec: 30 * 2 ** attempt, error: r.reason };
    await giveUp(`wa:cod:${orderId}`, r.reason ?? "Gave up after retries");
    await codSendFailed(orderId, r.reason ?? "Gave up after retries");
  }
  return { done: true };
});

registerHandler("whatsapp.send", async (p, attempt): Promise<JobResult> => {
  const { shipmentId, day } = p as { shipmentId: string; day?: string };
  const key = `wa:ofd:${shipmentId}:${day ?? new Date().toISOString().slice(0, 10)}`;
  const r = await sendOutForDelivery(shipmentId, key);
  if (r.retryable) {
    if (attempt < 5) return { retryInSec: 30 * 2 ** attempt, error: r.reason };
    await giveUp(key, r.reason ?? "Gave up after retries");
  }
  return { done: true };
});

registerHandler("cod.cancel", async (p, attempt): Promise<JobResult> => {
  const { confirmationId, shipmentId } = p as { confirmationId: string; shipmentId: string };
  return runCarrierCancellation(confirmationId, shipmentId, attempt);
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

/** store.sync — scheduled pull for connections with auto-sync on. */
registerHandler("store.sync", async (p): Promise<JobResult> => {
  const { syncStore } = await import("@/server/stores/sync");
  const db = await getDb();
  const [conn] = await db.select({ orgId: schema.storeConnections.orgId }).from(schema.storeConnections).where(eq(schema.storeConnections.id, String(p.connectionId)));
  if (!conn || !(await hasFeature(conn.orgId, "store_channels"))) return { done: true }; // module switched off by Admin
  const r = await syncStore(String(p.connectionId), { kind: "system" });
  return r.ok ? { done: true } : { retryInSec: 900, error: r.message };
});

/** store.push_tracking — after booking, send AWB + tracking link back to Shopify/WooCommerce. */
registerHandler("store.push_tracking", async (p, attempt): Promise<JobResult> => {
  const { pushTrackingForOrder } = await import("@/server/stores/sync");
  try { await pushTrackingForOrder(String(p.orderId)); return { done: true }; }
  catch (e) { return { retryInSec: Math.min(3600, 120 * 2 ** attempt), error: (e as Error).message }; }
});

/** Periodic sweeps: re-arm the webhook retry job, schedule store syncs, expire stale COD confirmations. */
export async function scheduleSweeps() {
  const minute = Math.floor(Date.now() / 60_000);
  await enqueue("webhook.retry", {}, { dedupeKey: `webhook.retry:${minute}` });
  const db = await getDb();
  const slot = Math.floor(minute / 15);
  const auto = await db.select({ id: schema.storeConnections.id }).from(schema.storeConnections).where(and(eq(schema.storeConnections.autoSync, true), eq(schema.storeConnections.status, "connected")));
  for (const c of auto) await enqueue("store.sync", { connectionId: c.id }, { dedupeKey: `store.sync:${c.id}:${slot}` });
  await sweepNoResponse();
}
