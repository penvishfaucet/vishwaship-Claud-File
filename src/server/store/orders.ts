import "server-only";
import { and, desc, eq, gte, ilike, inArray, lte, ne, or, sql, type SQL } from "drizzle-orm";
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
  pending: "Awaiting payment", paid: "Paid online", failed: "Payment failed", refund_due: "Refund due", refunded: "Refunded", cod_pending: "Cash on Delivery",
};

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
  return {
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

export type OrderListFilters = { q?: string; payment?: string; fulfilment?: string; method?: string; from?: string; to?: string };

export async function listStoreOrders(orgId: string, f: OrderListFilters) {
  const db = await getDb();
  const conds: SQL[] = [eq(schema.storeOrders.orgId, orgId)];
  if (f.payment && Object.keys(PAYMENT_LABEL).includes(f.payment)) conds.push(eq(schema.storeOrders.paymentStatus, f.payment));
  if (f.method === "cod" || f.method === "razorpay") conds.push(eq(schema.storeOrders.paymentMethod, f.method));
  if (f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from)) conds.push(gte(schema.storeOrders.createdAt, new Date(`${f.from}T00:00:00+05:30`)));
  if (f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to)) conds.push(lte(schema.storeOrders.createdAt, new Date(`${f.to}T23:59:59+05:30`)));
  const q = f.q?.trim().replace(/[%_]/g, "").slice(0, 60);
  if (q) conds.push(or(ilike(schema.storeOrders.number, `%${q}%`), sql`${schema.storeOrders.buyer}::text ilike ${`%${q}%`}`)!);
  const rows = await db.select().from(schema.storeOrders).where(and(...conds)).orderBy(desc(schema.storeOrders.createdAt)).limit(300);
  const facts = await shipFacts(rows.map((r) => r.shippingOrderId).filter((x): x is string => !!x));
  let out = rows.map((r) => present(r, facts));
  if (f.fulfilment && f.fulfilment in FULFILMENT_LABEL) out = out.filter((r) => r.fulfilment === f.fulfilment);
  return out;
}

export async function storeOrderForOrg(orgId: string, id: string) {
  const db = await getDb();
  const [o] = await db.select().from(schema.storeOrders).where(and(eq(schema.storeOrders.id, id), eq(schema.storeOrders.orgId, orgId)));
  if (!o) return null;
  return present(o, await shipFacts(o.shippingOrderId ? [o.shippingOrderId] : []));
}
