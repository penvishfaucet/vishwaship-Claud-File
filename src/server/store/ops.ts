import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { readSettings } from "@/lib/store-themes";
import { cancelStoreOrder, ensureShippingOrder } from "./checkout";
import { logOrderEvent } from "./stock";

/**
 * Order acceptance. A placed order (COD, or paid online) waits in "Pending Acceptance" until the merchant accepts it
 * (→ a shipping order is prepared and it moves to "To Pack") or rejects it with a reason (→ stock comes back, a paid
 * order is refunded at the gateway, the buyer is told). Stores can switch on auto-accept.
 * Accepting twice, or two people accepting at once, does nothing extra: the first conditional update wins.
 */
export type AcceptResult = { id: string; number: string; ok: boolean; message: string };

async function acceptOne(orgId: string, id: string, actorUserId: string | null): Promise<AcceptResult> {
  const db = await getDb();
  const [o] = await db.select().from(schema.storeOrders).where(and(eq(schema.storeOrders.id, id), eq(schema.storeOrders.orgId, orgId)));
  if (!o) return { id, number: "?", ok: false, message: "Order not found" };
  const r = (ok: boolean, message: string): AcceptResult => ({ id, number: o.number, ok, message });
  if (o.status === "pending_payment") return r(false, "Payment not received yet");
  if (o.status === "cancelled") return r(false, o.acceptance === "rejected" ? "Already rejected" : "Order is cancelled");
  if (o.acceptance === "accepted") return r(true, "Already accepted");
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, o.storeId));
  const wh = readSettings(store?.settings).checkout.warehouseId;
  if (!wh) return r(false, "Choose a pickup warehouse in Store setup → Checkout first");
  const [w] = await db.select({ id: schema.warehouses.id }).from(schema.warehouses).where(and(eq(schema.warehouses.id, wh), eq(schema.warehouses.orgId, orgId)));
  if (!w) return r(false, "The store's pickup warehouse no longer exists. Choose another in Store setup → Checkout");
  const won = await db.update(schema.storeOrders).set({ acceptance: "accepted", acceptedAt: new Date(), acceptedBy: actorUserId })
    .where(and(eq(schema.storeOrders.id, id), eq(schema.storeOrders.status, "placed"), eq(schema.storeOrders.acceptance, "pending"))).returning({ id: schema.storeOrders.id });
  if (!won.length) {
    const [x] = await db.select({ a: schema.storeOrders.acceptance }).from(schema.storeOrders).where(eq(schema.storeOrders.id, id));
    return r(x?.a === "accepted", x?.a === "accepted" ? "Already accepted" : "Order changed meanwhile; refresh and try again");
  }
  const sid = await ensureShippingOrder(id);
  if (!sid) {
    // could not prepare the shipment: put it back so it can be fixed and accepted again
    await db.update(schema.storeOrders).set({ acceptance: "pending", acceptedAt: null, acceptedBy: null }).where(eq(schema.storeOrders.id, id));
    return r(false, "Could not prepare the shipment. Check the buyer's address and the store's pickup warehouse");
  }
  await logOrderEvent(db, o, "accepted", actorUserId ? "Accepted; moved to To Pack" : "Accepted automatically (auto-accept is on)", actorUserId);
  return r(true, "Accepted");
}

/** Accept one or many orders; each order gets its own result (bulk accept never stops at the first problem). */
export async function acceptOrders(orgId: string, actorUserId: string, ids: string[]) {
  const out: AcceptResult[] = [];
  for (const id of [...new Set(ids)].slice(0, 200)) out.push(await acceptOne(orgId, id, actorUserId));
  return out;
}

/** Placed orders on stores with auto-accept go straight to To Pack. */
export async function autoAccept(storeOrderId: string) {
  const db = await getDb();
  const [o] = await db.select().from(schema.storeOrders).where(eq(schema.storeOrders.id, storeOrderId));
  if (!o || o.status !== "placed" || o.acceptance !== "pending") return;
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, o.storeId));
  if (readSettings(store?.settings).checkout.autoAccept) await acceptOne(o.orgId, o.id, null);
}

/** Reject one or many pending orders with a reason (required). */
export async function rejectOrders(orgId: string, actorUserId: string, ids: string[], reason: string) {
  const why = reason.trim();
  const db = await getDb();
  const out: Array<AcceptResult & { refund: string | null }> = [];
  for (const id of [...new Set(ids)].slice(0, 200)) {
    const [o] = await db.select().from(schema.storeOrders).where(and(eq(schema.storeOrders.id, id), eq(schema.storeOrders.orgId, orgId)));
    if (!o) { out.push({ id, number: "?", ok: false, message: "Order not found", refund: null }); continue; }
    if (why.length < 3) { out.push({ id, number: o.number, ok: false, message: "Give a reason for rejecting", refund: null }); continue; }
    if (o.status !== "placed" || o.acceptance !== "pending") {
      out.push({ id, number: o.number, ok: o.acceptance === "rejected", message: o.acceptance === "rejected" ? "Already rejected" : o.status === "pending_payment" ? "Payment not received yet" : "Only orders waiting for acceptance can be rejected (cancel accepted orders instead)", refund: null });
      continue;
    }
    const r = await cancelStoreOrder(orgId, id, why, actorUserId);
    out.push(r.ok ? { id, number: o.number, ok: true, message: "Rejected", refund: r.refund } : { id, number: o.number, ok: false, message: r.message, refund: null });
  }
  return out;
}

/** Tell the buyer (by email when they gave one) that the seller cancelled the order, and about the refund. */
export async function notifyBuyerCancelled(storeOrderId: string) {
  const db = await getDb();
  const [o] = await db.select().from(schema.storeOrders).where(eq(schema.storeOrders.id, storeOrderId));
  if (!o || o.status !== "cancelled") return;
  const b = o.buyer as { name: string; email?: string };
  if (!b.email) return;
  const [store] = await db.select({ name: schema.stores.name, slug: schema.stores.slug }).from(schema.stores).where(eq(schema.stores.id, o.storeId));
  const { sendEmail } = await import("@/server/email/service");
  const base = (process.env.APP_URL ?? (process.env.NODE_ENV === "production" ? "https://vishwaship.in" : "http://localhost:3000")).replace(/\/$/, "");
  const r = await sendEmail({
    event: "store_order_cancelled", to: b.email, toKind: "recipient", orgId: o.orgId, dedupeKey: `store_cancel:${o.id}`,
    vars: {
      customer_name: b.name, order_id: o.number, store_name: store?.name ?? "the store", reason: o.rejectReason ?? o.note ?? "Not available",
      refund_line: o.paymentMethod === "cod" ? "You have not been charged." : `Your payment of ₹${(o.totalPaise / 100).toFixed(2)} is being refunded to your original payment method. Banks usually take 5–7 working days.`,
      tracking_link: `${base}/s/${store?.slug ?? ""}/track/`,
    },
  });
  await logOrderEvent(db, o, "buyer_notified", r.status === "sent" ? `Buyer emailed at ${b.email}` : `Buyer email not sent (${r.error ?? r.status})`);
}

export async function orderTimeline(orgId: string, storeOrderId: string) {
  const db = await getDb();
  const rows = await db.select({ kind: schema.storeOrderEvents.kind, message: schema.storeOrderEvents.message, at: schema.storeOrderEvents.createdAt, actor: schema.users.name })
    .from(schema.storeOrderEvents).leftJoin(schema.users, eq(schema.users.id, schema.storeOrderEvents.actorUserId))
    .where(and(eq(schema.storeOrderEvents.storeOrderId, storeOrderId), eq(schema.storeOrderEvents.orgId, orgId))).orderBy(asc(schema.storeOrderEvents.createdAt));
  return rows;
}

/** Orders waiting for the merchant (sidebar badge). */
export async function pendingAcceptanceCount(orgId: string) {
  const db = await getDb();
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.storeOrders)
    .where(and(eq(schema.storeOrders.orgId, orgId), eq(schema.storeOrders.status, "placed"), eq(schema.storeOrders.acceptance, "pending")));
  return n;
}
