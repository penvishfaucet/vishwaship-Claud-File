import "server-only";
import { and, asc, desc, eq, gte, ilike, inArray, lte, ne, or, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { safeEqual } from "@/server/security/crypto";
import { STATUS_LABEL } from "@/server/tracking/public";
import type { CheckoutInput, Line } from "./checkout";

/**
 * Store orders, read side. Payment state is stored on the store order; fulfilment and COD collection/remittance are
 * read from the linked Vishwaship shipping order + shipment, so the two stay independent and are never copied.
 */

export type Fulfilment = "unfulfilled" | "booking" | "booked" | "in_transit" | "delivered" | "rto" | "cancelled";
export type CodState = "not_cod" | "payable" | "collected" | "remitted";

export const FULFILMENT_LABEL: Record<Fulfilment, string> = {
  unfulfilled: "Not shipped yet", booking: "Booking", booked: "Booked", in_transit: "In transit", delivered: "Delivered", rto: "Returned", cancelled: "Cancelled",
};
export const PAYMENT_LABEL: Record<string, string> = {
  pending: "Awaiting payment", paid: "Paid online", failed: "Payment failed", refund_due: "Refund due", refund_pending: "Refund in progress", refunded: "Refunded", cod_pending: "Cash on Delivery",
};

/** The merchant's workflow stage of an order (Online Store → Orders tabs). */
export type Stage = "awaiting_payment" | "payment_failed" | "pending_acceptance" | "to_pack" | "ready_to_ship" | "picked_up" | "in_transit" | "out_for_delivery" | "ndr" | "delivered" | "rto" | "rto_delivered" | "lost" | "rejected" | "cancelled";
export const STAGE_LABEL: Record<Stage, string> = {
  awaiting_payment: "Awaiting payment", payment_failed: "Payment not completed", pending_acceptance: "Pending acceptance", to_pack: "To pack", ready_to_ship: "Ready to ship",
  picked_up: "Picked up", in_transit: "In transit", out_for_delivery: "Out for delivery", ndr: "Delivery attempted (NDR)", delivered: "Delivered",
  rto: "RTO in transit", rto_delivered: "RTO delivered", lost: "Lost / damaged", rejected: "Rejected", cancelled: "Cancelled",
};
/** Tabs on the orders page and the stages each one shows. */
export const TABS = [
  { key: "pending", label: "Pending acceptance", stages: ["pending_acceptance"] },
  { key: "to_pack", label: "To pack", stages: ["to_pack"] },
  { key: "ready", label: "Ready to ship", stages: ["ready_to_ship"] },
  { key: "transit", label: "In transit", stages: ["picked_up", "in_transit", "out_for_delivery", "ndr"] },
  { key: "delivered", label: "Delivered", stages: ["delivered"] },
  { key: "rto", label: "RTO", stages: ["rto", "rto_delivered", "lost"] },
  { key: "cancelled", label: "Rejected / cancelled", stages: ["rejected", "cancelled"] },
  { key: "unpaid", label: "Failed payments", stages: ["awaiting_payment", "payment_failed"] },
  { key: "all", label: "All", stages: [] as string[] },
] as const;
export type TabKey = (typeof TABS)[number]["key"];

function stageOf(o: typeof schema.storeOrders.$inferSelect, ship: Ship): Stage {
  if (o.status === "pending_payment") return "awaiting_payment";
  if (o.status === "cancelled") return o.acceptance === "rejected" ? "rejected" : o.acceptance === "pending" && o.paymentStatus === "failed" ? "payment_failed" : "cancelled";
  if (o.acceptance !== "accepted") return "pending_acceptance";
  if (!ship || ship.bookingStatus === "cancelled" || ship.bookingStatus === "failed" || ship.status === "cancelled") return "to_pack";
  const s = ship.status;
  if (s === "booked" || s === "pickup_pending") return "ready_to_ship";
  if (s === "picked_up") return "picked_up";
  if (s === "in_transit" || s === "at_delivery_center") return "in_transit";
  if (s === "out_for_delivery") return "out_for_delivery";
  if (s === "ndr") return "ndr";
  if (s === "delivered") return "delivered";
  if (s === "rto_delivered") return "rto_delivered";
  if (s.startsWith("rto")) return "rto";
  if (s === "lost" || s === "damaged") return "lost";
  return "in_transit";
}

type Ship = { awb: string | null; carrierName: string; status: string; bookingStatus: string; id: string } | null;

function fulfilment(orderStatus: string | null, ship: Ship): Fulfilment {
  if (orderStatus === null) return "unfulfilled";
  if (ship && ship.bookingStatus !== "cancelled" && ship.bookingStatus !== "failed") {
    if (ship.status === "delivered") return "delivered";
    if (ship.status.startsWith("rto")) return "rto";
    if (ship.status === "cancelled") return "cancelled";
    if (["booked", "pickup_pending"].includes(ship.status)) return "booked";
    return "in_transit";
  }
  if (orderStatus === "cancelled") return "cancelled";
  if (orderStatus === "booking") return "booking";
  return "unfulfilled";
}

async function shipFacts(shippingOrderIds: string[]) {
  const db = await getDb();
  if (!shippingOrderIds.length) return { orders: new Map<string, string>(), ships: new Map<string, NonNullable<Ship>>(), remitted: new Set<string>() };
  const os = await db.select({ id: schema.orders.id, status: schema.orders.status }).from(schema.orders).where(inArray(schema.orders.id, shippingOrderIds));
  const ss = await db.select({ id: schema.shipments.id, orderId: schema.shipments.orderId, awb: schema.shipments.awb, carrierName: schema.shipments.carrierName, status: schema.shipments.status, bookingStatus: schema.shipments.bookingStatus, createdAt: schema.shipments.createdAt })
    .from(schema.shipments).where(and(inArray(schema.shipments.orderId, shippingOrderIds), ne(schema.shipments.bookingStatus, "cancelled"))).orderBy(desc(schema.shipments.createdAt));
  const ships = new Map<string, NonNullable<Ship>>();
  for (const s of ss) if (!ships.has(s.orderId)) ships.set(s.orderId, s);
  const shipIds = [...ships.values()].map((s) => s.id);
  const rem = shipIds.length ? await db.select({ id: schema.codRemittanceItems.shipmentId }).from(schema.codRemittanceItems)
    .innerJoin(schema.codRemittances, eq(schema.codRemittances.id, schema.codRemittanceItems.remittanceId))
    .where(and(inArray(schema.codRemittanceItems.shipmentId, shipIds), eq(schema.codRemittances.status, "paid"))) : [];
  return { orders: new Map(os.map((o) => [o.id, o.status])), ships, remitted: new Set(rem.map((r) => r.id)) };
}

function present(o: typeof schema.storeOrders.$inferSelect, f: Awaited<ReturnType<typeof shipFacts>>) {
  const ship = o.shippingOrderId ? f.ships.get(o.shippingOrderId) ?? null : null;
  const ful = o.status === "cancelled" ? "cancelled" : fulfilment(o.shippingOrderId ? f.orders.get(o.shippingOrderId) ?? null : null, ship);
  const cod: CodState = o.paymentMethod !== "cod" ? "not_cod" : ship && f.remitted.has(ship.id) ? "remitted" : ful === "delivered" ? "collected" : "payable";
  const stage = stageOf(o, ship);
  return {
    stage, acceptance: o.acceptance, acceptedAt: o.acceptedAt, rejectReason: o.rejectReason, refund: o.refund as import("./refunds").RefundState | null, stockState: o.stockState, placedAt: o.placedAt,
    items: (o.lines as Line[]).reduce((n, l) => n + l.qty, 0),
    id: o.id, number: o.number, status: o.status, paymentMethod: o.paymentMethod, paymentStatus: o.paymentStatus, fulfilment: ful, cod,
    buyer: o.buyer as CheckoutInput["buyer"], lines: o.lines as Line[], subtotalPaise: o.subtotalPaise, discountPaise: o.discountPaise, shippingPaise: o.shippingPaise,
    codFeePaise: o.codFeePaise, totalPaise: o.totalPaise, couponCode: o.couponCode, shippingOrderId: o.shippingOrderId, note: o.note,
    awb: ship?.awb ?? null, shipmentId: ship?.id ?? null, carrierName: ship?.carrierName ?? null, trackingLabel: ship ? STATUS_LABEL[ship.status] ?? ship.status : null,
    createdAt: o.createdAt, paidAt: o.paidAt, cancelledAt: o.cancelledAt, attribution: o.attribution as Record<string, string>,
  };
}
export type StoreOrderView = ReturnType<typeof present>;

/** Buyer confirmation page: needs the secret token from the confirmation link. */
export async function buyerOrder(storeId: string, number: string, token: string) {
  const db = await getDb();
  const [o] = await db.select().from(schema.storeOrders).where(and(eq(schema.storeOrders.storeId, storeId), eq(schema.storeOrders.number, number)));
  if (!o || !token || !safeEqual(o.buyerToken, token)) return null;
  return present(o, await shipFacts(o.shippingOrderId ? [o.shippingOrderId] : []));
}

/** Buyer "Track order" by order number + mobile number. */
export async function buyerOrderByMobile(storeId: string, number: string, mobile: string) {
  const db = await getDb();
  const [o] = await db.select().from(schema.storeOrders).where(and(eq(schema.storeOrders.storeId, storeId), eq(schema.storeOrders.number, number.trim().toUpperCase())));
  const m = mobile.replace(/\D/g, "").slice(-10);
  if (!o || (o.buyer as { mobile: string }).mobile !== m) return null;
  return present(o, await shipFacts(o.shippingOrderId ? [o.shippingOrderId] : []));
}

export type OrderListFilters = { q?: string; payment?: string; fulfilment?: string; method?: string; from?: string; to?: string; tab?: string };

export async function listStoreOrders(orgId: string, f: OrderListFilters) {
  const db = await getDb();
  const conds: SQL[] = [eq(schema.storeOrders.orgId, orgId)];
  if (f.payment && Object.keys(PAYMENT_LABEL).includes(f.payment)) conds.push(eq(schema.storeOrders.paymentStatus, f.payment));
  if (f.method === "cod") conds.push(eq(schema.storeOrders.paymentMethod, "cod"));
  if (f.method === "online" || f.method === "razorpay") conds.push(ne(schema.storeOrders.paymentMethod, "cod"));
  if (f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from)) conds.push(gte(schema.storeOrders.createdAt, new Date(`${f.from}T00:00:00+05:30`)));
  if (f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to)) conds.push(lte(schema.storeOrders.createdAt, new Date(`${f.to}T23:59:59+05:30`)));
  const q = f.q?.trim().replace(/[%_]/g, "").slice(0, 60);
  if (q) conds.push(or(ilike(schema.storeOrders.number, `%${q}%`), sql`${schema.storeOrders.buyer}::text ilike ${`%${q}%`}`)!);
  const tab = TABS.find((t) => t.key === f.tab);
  // narrow in the database where the tab allows it (the rest depends on the shipment and is filtered below)
  if (tab?.key === "pending") conds.push(eq(schema.storeOrders.status, "placed"), eq(schema.storeOrders.acceptance, "pending"));
  else if (tab?.key === "unpaid") conds.push(or(eq(schema.storeOrders.status, "pending_payment"), and(eq(schema.storeOrders.status, "cancelled"), eq(schema.storeOrders.acceptance, "pending"), eq(schema.storeOrders.paymentStatus, "failed")))!);
  else if (tab?.key === "cancelled") conds.push(eq(schema.storeOrders.status, "cancelled"));
  else if (tab && tab.key !== "all") conds.push(eq(schema.storeOrders.status, "placed"), eq(schema.storeOrders.acceptance, "accepted"));
  // oldest first while waiting for the merchant, newest first everywhere else
  const order = tab?.key === "pending" || tab?.key === "to_pack" ? asc(schema.storeOrders.createdAt) : desc(schema.storeOrders.createdAt);
  const rows = await db.select().from(schema.storeOrders).where(and(...conds)).orderBy(order).limit(1000);
  const facts = await shipFacts(rows.map((r) => r.shippingOrderId).filter((x): x is string => !!x));
  let out = rows.map((r) => present(r, facts));
  if (f.fulfilment && f.fulfilment in FULFILMENT_LABEL) out = out.filter((r) => r.fulfilment === f.fulfilment);
  if (tab && tab.stages.length) out = out.filter((r) => (tab.stages as readonly string[]).includes(r.stage));
  return out;
}

/** How many orders sit in each tab (for the tab counters and the overview cards). */
export async function tabCounts(orgId: string) {
  const db = await getDb();
  const since = new Date(Date.now() - 120 * 86_400_000);
  const rows = await db.select().from(schema.storeOrders).where(and(eq(schema.storeOrders.orgId, orgId), or(gte(schema.storeOrders.createdAt, since), and(eq(schema.storeOrders.status, "placed"), ne(schema.storeOrders.stockState, "deducted")))!)).limit(5000);
  const facts = await shipFacts(rows.filter((r) => r.status === "placed").map((r) => r.shippingOrderId).filter((x): x is string => !!x));
  const counts: Record<string, number> = {};
  for (const r of rows) {
    const st = present(r, facts).stage;
    for (const t of TABS) if ((t.stages as readonly string[]).includes(st)) counts[t.key] = (counts[t.key] ?? 0) + 1;
  }
  return counts;
}

export async function storeOrderForOrg(orgId: string, id: string) {
  const db = await getDb();
  const [o] = await db.select().from(schema.storeOrders).where(and(eq(schema.storeOrders.id, id), eq(schema.storeOrders.orgId, orgId)));
  if (!o) return null;
  return present(o, await shipFacts(o.shippingOrderId ? [o.shippingOrderId] : []));
}
