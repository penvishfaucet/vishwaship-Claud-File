import "server-only";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { readSettings } from "@/lib/store-themes";
import { roughDelivery } from "@/lib/cod-template";
import { getDb, schema } from "@/server/db/client";
import { hideProviders } from "@/server/customer-safe";
import { enqueue } from "@/server/jobs/runner";
import { logOrderEvent } from "./stock";

/**
 * Online Store buyer updates, by email and WhatsApp (owner 2026-11-23):
 *   accepted   → "your order is confirmed, we dispatch it by <date>, expected delivery <date>"
 *   cancelled  → "sorry, cancelled: <reason>; refund line"
 *   dispatched → "handed to <courier>, AWB, tracking link" (first pickup / in-transit scan)
 * Each message goes once per order (email log + WhatsApp message dedupe keys), so retries and repeated sweeps are safe.
 * WhatsApp needs an approved template per event (Admin → WhatsApp → Template mapping); without one it is recorded as
 * not sent, never faked.
 */
export type StoreNotice = "accepted" | "cancelled" | "dispatched";

const appUrl = () => (process.env.APP_URL ?? (process.env.NODE_ENV === "production" ? "https://vishwaship.in" : "http://localhost:3000")).replace(/\/$/, "");
const IST = 5.5 * 3600_000;
const istDay = (d: Date) => d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", weekday: "short", day: "2-digit", month: "short" });

/** Dispatch promise: `days` working days after acceptance (Sundays skipped). 24 h setting = next day. */
export function dispatchByDate(acceptedAt: Date, withinHours: number) {
  const days = Math.max(1, Math.ceil(withinHours / 24));
  const d = new Date(acceptedAt.getTime());
  let left = days;
  while (left > 0) { d.setUTCDate(d.getUTCDate() + 1); if (new Date(d.getTime() + IST).getUTCDay() !== 0) left--; }
  return d;
}

export async function queueStoreNotice(storeOrderId: string, kind: StoreNotice) {
  await enqueue("store.notify", { storeOrderId, kind }, { dedupeKey: `store.notify:${kind}:${storeOrderId}` });
}

/** Send one update to the buyer (email + WhatsApp). Returns what happened on each channel. */
export async function notifyBuyer(storeOrderId: string, kind: StoreNotice) {
  const db = await getDb();
  const [o] = await db.select().from(schema.storeOrders).where(eq(schema.storeOrders.id, storeOrderId));
  if (!o) return { email: "skipped", whatsapp: "skipped" };
  if (kind === "cancelled" ? o.status !== "cancelled" : o.status === "cancelled") return { email: "skipped", whatsapp: "skipped" };
  const b = o.buyer as { name: string; mobile?: string; email?: string; state?: string };
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, o.storeId));
  const settings = readSettings(store?.settings);
  const storeName = store?.name ?? "the store";
  const vars: Record<string, string> = { customer_name: b.name, order_id: o.number, store_name: storeName, tracking_link: `${appUrl()}/s/${store?.slug ?? ""}/track/` };

  if (kind === "accepted") {
    const [w] = settings.checkout.warehouseId ? await db.select({ state: schema.warehouses.state }).from(schema.warehouses).where(eq(schema.warehouses.id, settings.checkout.warehouseId)) : [];
    const by = dispatchByDate(o.acceptedAt ?? new Date(), settings.checkout.dispatchWithinHours);
    vars.dispatch_by = istDay(by);
    vars.expected_delivery = istDay(roughDelivery(w?.state, b.state, by));
    vars.order_total = `₹${(o.totalPaise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
    vars.payment_line = o.paymentMethod === "cod" ? `Please keep ${vars.order_total} ready to pay on delivery.` : "Your payment is received.";
  }
  if (kind === "cancelled") {
    vars.reason = o.rejectReason ?? o.note ?? "Not available";
    vars.refund_line = o.paymentMethod === "cod" ? "You have not been charged." : `Your payment of ₹${(o.totalPaise / 100).toFixed(2)} is being refunded to your original payment method. Banks usually take 5–7 working days.`;
  }
  let shipmentId: string | null = null;
  if (kind === "dispatched") {
    const [s] = o.shippingOrderId ? await db.select().from(schema.shipments)
      .where(and(eq(schema.shipments.orderId, o.shippingOrderId), sql`${schema.shipments.status} <> 'cancelled'`)).orderBy(sql`${schema.shipments.createdAt} desc`).limit(1) : [];
    if (!s?.awb) return { email: "skipped", whatsapp: "skipped" };
    shipmentId = s.id;
    const { ensurePublicRef } = await import("@/server/tracking/service");
    vars.courier_name = hideProviders(s.carrierName);
    vars.awb_number = s.awb;
    vars.tracking_link = `${appUrl()}/t/${await ensurePublicRef(s.id)}`;
    vars.expected_delivery = s.etaDate ? istDay(s.etaDate) : "in a few days";
  }

  // email (only when the buyer gave one)
  let email = "skipped";
  if (b.email) {
    const { sendEmail } = await import("@/server/email/service");
    const r = await sendEmail({ event: `store_order_${kind}`, to: b.email, toKind: "recipient", orgId: o.orgId, dedupeKey: `store_${kind}:${o.id}`, vars });
    email = r.status === "sent" || r.status === "duplicate" ? r.status : `${r.status}${r.error ? ` (${r.error})` : ""}`;
  }
  // WhatsApp to the buyer's mobile
  const { sendEvent } = await import("@/server/whatsapp/service");
  const wa = await sendEvent({
    event: `store_order_${kind}`, orgId: o.orgId, orderId: o.shippingOrderId ?? null, shipmentId, dedupeKey: `wa:store:${kind}:${o.id}`,
    recipient: { name: b.name, mobile: b.mobile ?? "", orderNumber: o.number }, params: { ...vars, merchant_name: storeName },
  });
  const whatsapp = wa.status === "sent" || wa.status === "duplicate" ? wa.status : `${wa.status}${wa.reason ? ` (${wa.reason})` : ""}`;
  const label = kind === "accepted" ? "Order confirmed" : kind === "cancelled" ? "Cancellation" : "Dispatch";
  await logOrderEvent(db, o, `buyer_${kind}_notified`, `${label} message to the buyer: email ${email}; WhatsApp ${whatsapp}`);
  return { email, whatsapp };
}

/** Sweep: accepted store orders whose parcel the courier has picked up get one "dispatched" message. */
export async function sweepDispatchNotices() {
  const db = await getDb();
  const since = new Date(Date.now() - 3 * 86_400_000);
  const rows = await db.select({ id: schema.storeOrders.id }).from(schema.storeOrders)
    .innerJoin(schema.shipments, eq(schema.shipments.orderId, schema.storeOrders.shippingOrderId))
    .where(and(eq(schema.storeOrders.status, "placed"), eq(schema.storeOrders.acceptance, "accepted"),
      inArray(schema.shipments.status, ["picked_up", "in_transit", "at_delivery_center", "out_for_delivery"]), gte(schema.shipments.lastEventAt, since),
      sql`not exists (select 1 from ${schema.storeOrderEvents} e where e.store_order_id = ${schema.storeOrders.id} and e.kind = 'buyer_dispatched_notified')`))
    .limit(100);
  for (const r of rows) await queueStoreNotice(r.id, "dispatched");
  return rows.length;
}
