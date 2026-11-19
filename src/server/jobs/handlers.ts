import { and, eq, gte, inArray, isNotNull, lte, lt, ne } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { audit } from "@/server/audit";
import { hasFeature } from "@/server/features";
import { withLedger } from "@/server/ledger/db-store";
import { release, settle } from "@/server/ledger/wallet";
import { adapterFor, providerContext } from "@/server/providers/registry";
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
  const { orderId, quoteId, reservationId } = p as { orderId: string; quoteId: string; reservationId: string | null };
  const db = await getDb();
  const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
  const [quote] = await db.select().from(schema.quotes).where(eq(schema.quotes.id, quoteId));
  if (!order || !quote) return { dead: "order or quote missing" };
  const [wallet] = await db.select().from(schema.wallets).where(eq(schema.wallets.orgId, order.orgId));
  const [acct] = await db.select().from(schema.providerAccounts).where(eq(schema.providerAccounts.id, quote.providerAccountId!));
  const ad = acct && adapterFor(acct);
  if (!ad) return { dead: "adapter unavailable" };
  const [existing] = await db.select().from(schema.shipments).where(eq(schema.shipments.orderId, orderId));
  // async carriers (Delhivery B2B) need the job / LR reference returned at booking
  const r = await ad.lookupBooking(await providerContext(acct), { vishwashipOrderId: orderId, providerOrderRef: existing?.providerOrderRef ?? undefined });
  if (!r.ok) return { retryInSec: Math.min(3600, 60 * 2 ** attempt), error: r.error.message };
  if (r.value && r.value.state === "confirmed") {
    const priced = quote.priced as { carrierName: string; costPreTax: number; chargeableWeightGrams: number };
    const shipmentId = existing?.id ?? newId("shp");
    if (existing) {
      await db.update(schema.shipments).set({ bookingStatus: "confirmed", providerOrderRef: r.value.providerOrderRef || existing.providerOrderRef, awb: r.value.awb ?? existing.awb, lrNumber: r.value.lrNumber ?? existing.lrNumber, pieceIds: r.value.pieceIds ?? existing.pieceIds, labelStatus: r.value.labelAvailable ? "available" : existing.labelStatus }).where(eq(schema.shipments.id, existing.id));
      await db.insert(schema.inAppAlerts).values({ id: newId("al"), orgId: order.orgId, kind: "tracking", title: `Booking confirmed by the courier${r.value.lrNumber ? ` — LR ${r.value.lrNumber}` : r.value.awb ? ` — AWB ${r.value.awb}` : ""}`, href: `/portal/orders/${orderId}/` });
    } else {
      await db.insert(schema.shipments).values({
        id: shipmentId, orgId: order.orgId, orderId, providerAccountId: acct.id, provider: acct.adapter, carrierCode: quote.carrierCode, carrierName: priced.carrierName,
        serviceName: quote.serviceName, providerOrderRef: r.value.providerOrderRef, awb: r.value.awb, lrNumber: r.value.lrNumber ?? null, bookingStatus: "confirmed",
        status: "booked", quoteId, sellPaise: quote.totalPaise, costPaise: priced.costPreTax, reservationId, chargeableWeightGrams: priced.chargeableWeightGrams,
      });
    }
    if (r.value.carrierChargePaise != null) await (await import("@/server/booking/service")).recordCarrierCharge(shipmentId, r.value.carrierChargePaise, priced.costPreTax);
    if (reservationId) await withLedger((s) => settle(s, { walletId: wallet.id, reservationId, idempotencyKey: `settle:${reservationId}`, refType: "shipment", refId: shipmentId, memo: `Shipping charge ${order.orderNumber} (reconciled)` }));
    await db.update(schema.orders).set({ status: "booked" }).where(eq(schema.orders.id, orderId));
    await audit({ actorKind: "system", orgId: order.orgId, action: "booking.reconciled_confirmed", targetType: "order", targetId: orderId });
    return { done: true };
  }
  if (r.value === null) {
    if (existing && existing.bookingStatus === "confirmed") return { dead: "shipment exists but provider reports none — manual review" };
    if (existing) await db.update(schema.shipments).set({ bookingStatus: "failed", status: "cancelled" }).where(eq(schema.shipments.id, existing.id));
    if (reservationId) await withLedger((s) => release(s, { walletId: wallet.id, reservationId, idempotencyKey: `release:${reservationId}`, refType: "order", refId: orderId, memo: `Released: ${order.orderNumber} not booked (reconciled)` }));
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
  await scheduleTrackingPolls();
}

/** report.export — build a CSV/XLSX for Tools → Report Download (same filters and tenant scope as on screen). */
registerHandler("report.export", async (p): Promise<JobResult> => {
  const { exportId } = p as { exportId: string };
  const db = await getDb();
  const [x] = await db.select().from(schema.reportExports).where(eq(schema.reportExports.id, exportId));
  if (!x || x.status === "ready") return { done: true };
  await db.update(schema.reportExports).set({ status: "running" }).where(eq(schema.reportExports.id, x.id));
  try {
    const { REPORTS, parseFilters, runReport } = await import("@/server/reports");
    const { toCsv } = await import("@/lib/csv");
    const { toXlsx } = await import("@/server/xlsx");
    const key = x.reportKey as keyof typeof REPORTS;
    const r = await runReport(x.orgId, key, parseFilters(x.filters as Record<string, string>), 100_000);
    const headers = r.columns.map((c) => c.label);
    const buf = x.format === "xlsx" ? Buffer.from(await toXlsx(REPORTS[key].title, headers, r.rows)) : Buffer.from(toCsv(headers, r.rows), "utf8");
    if (buf.length > 12 * 1024 * 1024) throw new Error("Export is larger than 12 MB — narrow the date range");
    await db.update(schema.reportExports).set({ status: "ready", rowCount: r.total, fileB64: buf.toString("base64"), finishedAt: new Date(), expiresAt: new Date(Date.now() + 7 * 86400_000), error: null }).where(eq(schema.reportExports.id, x.id));
    await db.insert(schema.inAppAlerts).values({ id: newId("al"), orgId: x.orgId, kind: "report", title: `Your ${REPORTS[key].title} export is ready (${r.total} rows)`, href: "/portal/tools/downloads/" });
  } catch (e) {
    await db.update(schema.reportExports).set({ status: "failed", error: (e as Error).message.slice(0, 300), finishedAt: new Date() }).where(eq(schema.reportExports.id, x.id));
  }
  return { done: true };
});

/** warehouse.sync — register a new / edited pickup address with every courier account the customer can book. */
registerHandler("warehouse.sync", async (p, attempt): Promise<JobResult> => {
  const { syncWarehouseEverywhere } = await import("@/server/carriers/automation");
  const r = await syncWarehouseEverywhere(String(p.warehouseId));
  if (r.failed.length && attempt < 5) return { retryInSec: 300 * 2 ** attempt, error: r.failed.join("; ").slice(0, 300) };
  return { done: true };
});

/** pickup.auto — raise the courier pickup request right after booking (next slot: today before 2 pm IST, else tomorrow). */
registerHandler("pickup.auto", async (p, attempt): Promise<JobResult> => {
  const { nextPickupDate, requestPickup } = await import("@/server/carriers/automation");
  const r = await requestPickup(String(p.shipmentId), nextPickupDate(), { kind: "system" });
  if (r.ok) return { done: true };
  if (r.retry && attempt < 8) return { retryInSec: Math.min(3600, 120 * 2 ** attempt), error: r.message };
  if (r.retry) {
    const db = await getDb();
    const [sh] = await db.select({ orgId: schema.shipments.orgId, orderId: schema.shipments.orderId }).from(schema.shipments).where(eq(schema.shipments.id, String(p.shipmentId)));
    if (sh) await db.insert(schema.inAppAlerts).values({ id: newId("al"), orgId: sh.orgId, kind: "tracking", title: `Automatic pickup request failed — please schedule pickup: ${(await import("@/server/customer-safe")).hideProviders(r.message)}`.slice(0, 200), href: `/portal/orders/${sh.orderId}/` });
  }
  return { done: true };
});

/**
 * tracking.poll — refresh every live-courier shipment that is still moving, every 30 minutes (≤500 per slot keeps us
 * inside provider rate limits). Paused accounts keep syncing: pausing only stops new quotes and bookings.
 * Demo shipments are refreshed on demand only.
 */
registerHandler("tracking.poll", async (p): Promise<JobResult> => {
  const { refreshFromCarrier } = await import("@/server/tracking/service");
  await refreshFromCarrier(String(p.shipmentId)).catch(() => null);
  return { done: true };
});

let lastPollSlot = -1;
export async function scheduleTrackingPolls() {
  const slot = Math.floor(Date.now() / (30 * 60_000));
  if (slot === lastPollSlot) return; // once per 30-minute slot per process (jobs are also deduped per slot)
  lastPollSlot = slot;
  const db = await getDb();
  const live = await db.select({ id: schema.shipments.id }).from(schema.shipments)
    .where(and(eq(schema.shipments.bookingStatus, "confirmed"), ne(schema.shipments.provider, "demo"), isNotNull(schema.shipments.awb),
      inArray(schema.shipments.status, ["booked", "pickup_pending", "picked_up", "in_transit", "at_delivery_center", "out_for_delivery", "ndr", "rto_initiated", "rto_in_transit"])))
    .limit(500);
  for (const s of live) await enqueue("tracking.poll", { shipmentId: s.id }, { dedupeKey: `track:${s.id}:${slot}` });
  // Bookings the carrier accepted but has not numbered yet (LR/AWB pending), and timed-out attempts: keep asking the
  // carrier every slot for up to 14 days, even after the first reconcile job ran out of attempts. lookupBooking only
  // reads — it never creates a second booking.
  const since = new Date(Date.now() - 14 * 86400_000);
  const pending = await db.select({ id: schema.shipments.id, orderId: schema.shipments.orderId, quoteId: schema.shipments.quoteId, reservationId: schema.shipments.reservationId }).from(schema.shipments)
    .where(and(eq(schema.shipments.bookingStatus, "pending"), ne(schema.shipments.provider, "demo"), gte(schema.shipments.createdAt, since))).limit(200);
  for (const s of pending) await enqueue("booking.reconcile", { orderId: s.orderId, quoteId: s.quoteId, reservationId: s.reservationId, shipmentId: s.id }, { dedupeKey: `reconcile-sweep:${s.id}:${slot}` });
}
