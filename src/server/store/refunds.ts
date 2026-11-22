import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { type GwRefund, RefundRejected, gatewayRefundCreate, gatewayRefundLookup, isGatewayKey } from "./gateways";
import { razorpayRefundCreate, razorpayRefundLookup } from "./razorpay";
import { logOrderEvent } from "./stock";

/**
 * Refunds of online payments, made on the merchant's own gateway account. The status shown to the merchant is the
 * gateway's own (pending → processed / failed), re-read by the background sweep. Each refund has our own refId, which
 * the gateways use to reject duplicates, so a retry after a timeout never refunds twice. If a gateway refuses for good,
 * the order is "refund due" and the merchant refunds from their gateway dashboard, then marks it refunded.
 */
export type RefundState = {
  gateway: string; refId: string; gatewayRefundId: string | null; amountPaise: number;
  status: "starting" | "pending" | "processed" | "failed"; message: string; startedAt: string; updatedAt: string;
};
export const REFUND_LABEL: Record<RefundState["status"], string> = { starting: "Refund being started", pending: "Refund in progress at the gateway", processed: "Refunded to the buyer", failed: "Gateway could not refund" };

type O = typeof schema.storeOrders.$inferSelect;

async function lookup(o: O, r: RefundState): Promise<GwRefund | null> {
  if (o.paymentMethod === "razorpay") {
    if (!o.razorpayPaymentId) throw new RefundRejected("Razorpay payment id is missing");
    return razorpayRefundLookup(o.orgId, o.razorpayPaymentId, r.refId);
  }
  if (!isGatewayKey(o.paymentMethod) || !o.pgOrderId) throw new RefundRejected("This payment cannot be refunded automatically");
  return gatewayRefundLookup(o.orgId, o.paymentMethod, { pgOrderId: o.pgOrderId, paymentId: o.pgPaymentId, refId: r.refId, amountPaise: r.amountPaise });
}
async function create(o: O, r: RefundState): Promise<GwRefund> {
  if (o.paymentMethod === "razorpay") {
    if (!o.razorpayPaymentId) throw new RefundRejected("Razorpay payment id is missing");
    return razorpayRefundCreate(o.orgId, o.razorpayPaymentId, r.amountPaise, r.refId);
  }
  if (!isGatewayKey(o.paymentMethod) || !o.pgOrderId) throw new RefundRejected("This payment cannot be refunded automatically");
  return gatewayRefundCreate(o.orgId, o.paymentMethod, { pgOrderId: o.pgOrderId, paymentId: o.pgPaymentId, refId: r.refId, amountPaise: r.amountPaise });
}

async function apply(o: O, r: RefundState, g: GwRefund): Promise<RefundState> {
  const db = await getDb();
  const next: RefundState = { ...r, status: g.status, gatewayRefundId: g.id ?? r.gatewayRefundId, message: g.message.slice(0, 300), updatedAt: new Date().toISOString() };
  const pay = g.status === "processed" ? "refunded" : g.status === "failed" ? "refund_due" : "refund_pending";
  const upd = await db.update(schema.storeOrders).set({ refund: next, paymentStatus: pay })
    .where(and(eq(schema.storeOrders.id, o.id), sql`${schema.storeOrders.refund}->>'refId' = ${r.refId}`, sql`${schema.storeOrders.refund}->>'status' = ${r.status}`)).returning({ id: schema.storeOrders.id });
  if (upd.length && next.status !== r.status) {
    if (next.status === "processed") await logOrderEvent(db, o, "refund_done", `Refund of ₹${(r.amountPaise / 100).toFixed(2)} processed by the gateway`);
    if (next.status === "pending") await logOrderEvent(db, o, "refund_pending", "Refund accepted by the gateway; waiting for the bank");
    if (next.status === "failed") await logOrderEvent(db, o, "refund_failed", `Gateway could not refund: ${next.message || "no reason given"}. Refund the buyer from your gateway dashboard, then mark it refunded.`);
  }
  return next;
}

/** Bring one refund up to date with the gateway (creates it at the gateway if it was never sent). Never throws. */
export async function syncRefund(o: O): Promise<RefundState | null> {
  const r = o.refund as RefundState | null;
  if (!r || r.status === "processed" || r.status === "failed") return r;
  try {
    let g = await lookup(o, r);
    if (!g && r.status === "starting") g = await create(o, r);
    return g ? await apply(o, r, g) : r;
  } catch (e) {
    if (e instanceof RefundRejected) {
      // a duplicate refId is refused too: if the gateway has our refund after all, follow it instead of failing
      const again = await lookup(o, r).catch(() => null);
      return apply(o, r, again ?? { id: null, status: "failed", message: e.message });
    }
    console.error("[store refund]", o.id, (e as Error).message);
    return r; // gateway unreachable: the sweep tries again
  }
}

/** Refund a paid online order in full (rejected or cancelled by the merchant). Idempotent. */
export async function startRefund(storeOrderId: string, actorUserId: string | null = null): Promise<RefundState | null> {
  const db = await getDb();
  const [o] = await db.select().from(schema.storeOrders).where(eq(schema.storeOrders.id, storeOrderId));
  if (!o || o.paymentMethod === "cod") return null;
  const cur = o.refund as RefundState | null;
  if (cur && cur.status !== "failed") return syncRefund(o);
  if (!["paid", "refund_due"].includes(o.paymentStatus)) return cur;
  const now = new Date().toISOString();
  const state: RefundState = {
    gateway: o.paymentMethod, refId: `R${o.number.replace(/[^A-Za-z0-9]/g, "").slice(0, 16)}${randomBytes(5).toString("hex")}`, gatewayRefundId: null,
    amountPaise: o.totalPaise, status: "starting", message: "", startedAt: now, updatedAt: now,
  };
  const won = await db.update(schema.storeOrders).set({ refund: state, paymentStatus: "refund_pending" })
    .where(and(eq(schema.storeOrders.id, o.id), inArray(schema.storeOrders.paymentStatus, ["paid", "refund_due"]), or(isNull(schema.storeOrders.refund), sql`${schema.storeOrders.refund}->>'status' = 'failed'`)))
    .returning();
  if (!won.length) { const [x] = await db.select().from(schema.storeOrders).where(eq(schema.storeOrders.id, o.id)); return x.refund as RefundState | null; }
  await logOrderEvent(db, o, "refund_started", `Refund of ₹${(o.totalPaise / 100).toFixed(2)} sent to ${o.paymentMethod}`, actorUserId);
  return syncRefund(won[0]);
}

/** Background: follow refunds that are still starting (older than 2 min, so we never race a live request) or pending. */
export async function sweepRefunds(now = new Date()) {
  const db = await getDb();
  const rows = await db.select().from(schema.storeOrders).where(and(eq(schema.storeOrders.paymentStatus, "refund_pending"),
    or(sql`${schema.storeOrders.refund}->>'status' = 'pending'`, and(sql`${schema.storeOrders.refund}->>'status' = 'starting'`, sql`(${schema.storeOrders.refund}->>'startedAt')::timestamptz < ${new Date(now.getTime() - 2 * 60_000).toISOString()}::timestamptz`)))).limit(50);
  for (const o of rows) await syncRefund(o);
  return rows.length;
}
