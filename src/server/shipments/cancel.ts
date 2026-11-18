import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db/client";
import { withLedger } from "@/server/ledger/db-store";
import { credit } from "@/server/ledger/wallet";
import { adapterFor, providerContext } from "@/server/providers/registry";

const PRE_PICKUP = ["booked", "pickup_pending"];
export type CancelResult = { ok: true; state: "cancelled"; refundedPaise: number; message: string } | { ok: false; state: "not_found" | "not_allowed" | "failed"; message: string };

/**
 * Customer-requested cancellation of an order (and its shipment, if booked).
 * Not booked → cancelled immediately. Booked & before pickup → courier cancellation; on acknowledgement
 * the shipping charge is refunded once (idempotent ledger key). After pickup → not allowed (use RTO).
 */
export async function cancelOrder(a: { orgId: string; orderId: string; actorUserId: string; actorKind: "customer" | "staff"; reason?: string }): Promise<CancelResult> {
  const db = await getDb();
  const [order] = await db.select().from(schema.orders).where(and(eq(schema.orders.id, a.orderId), eq(schema.orders.orgId, a.orgId)));
  if (!order) return { ok: false, state: "not_found", message: "Order not found" };
  if (order.status === "cancelled") return { ok: false, state: "not_allowed", message: "Order is already cancelled" };
  if (["booking", "needs_reconcile"].includes(order.status)) return { ok: false, state: "not_allowed", message: "A booking is being confirmed with the courier. Try again in a few minutes." };
  const [ship] = await db.select().from(schema.shipments).where(and(eq(schema.shipments.orderId, order.id), inArray(schema.shipments.bookingStatus, ["confirmed", "pending", "ambiguous"])));
  if (!ship) {
    const upd = await db.update(schema.orders).set({ status: "cancelled" }).where(and(eq(schema.orders.id, order.id), inArray(schema.orders.status, ["draft", "ready", "cod_hold", "booking_failed"]))).returning({ id: schema.orders.id });
    if (!upd.length) return { ok: false, state: "not_allowed", message: "This order cannot be cancelled in its current state" };
    await db.update(schema.codConfirmations).set({ cancellationStatus: "cancelled", cancellationReason: "Cancelled by seller", cancellationAt: new Date() }).where(and(eq(schema.codConfirmations.orderId, order.id), inArray(schema.codConfirmations.status, ["pending", "no_response", "needs_review", "send_failed"])));
    await audit({ actorUserId: a.actorUserId, actorKind: a.actorKind, orgId: a.orgId, action: "order.cancel", targetType: "order", targetId: order.id, details: { reason: a.reason } });
    return { ok: true, state: "cancelled", refundedPaise: 0, message: "Order cancelled" };
  }
  if (ship.bookingStatus !== "confirmed" || !PRE_PICKUP.includes(ship.status)) {
    return { ok: false, state: "not_allowed", message: `Shipment is ${ship.status.replace(/_/g, " ")} — the courier no longer accepts cancellation. Raise an RTO from NDR or contact support.` };
  }
  const [acct] = await db.select().from(schema.providerAccounts).where(eq(schema.providerAccounts.id, ship.providerAccountId));
  const ad = acct ? adapterFor(acct) : null;
  if (!acct || !ad || !ad.implemented.includes("cancel")) return { ok: false, state: "failed", message: "This courier does not support cancellation through Vishwaship. Contact support." };
  const r = await ad.cancel(await providerContext(acct), { providerOrderRef: ship.providerOrderRef ?? ship.orderId, awb: ship.awb });
  await audit({ actorUserId: a.actorUserId, actorKind: a.actorKind, orgId: a.orgId, action: r.ok && r.value.acknowledged ? "shipment.cancel" : "shipment.cancel_failed", targetType: "order", targetId: order.id, details: { awb: ship.awb, reason: a.reason, error: r.ok ? undefined : r.error.message } });
  if (!r.ok) return { ok: false, state: "failed", message: `Courier did not cancel: ${r.error.message}` };
  if (!r.value.acknowledged) return { ok: false, state: "failed", message: "Courier did not acknowledge the cancellation. Contact support." };
  await db.update(schema.shipments).set({ bookingStatus: "cancelled", status: "cancelled" }).where(eq(schema.shipments.id, ship.id));
  await db.update(schema.orders).set({ status: "cancelled" }).where(eq(schema.orders.id, order.id));
  const [wallet] = await db.select().from(schema.wallets).where(eq(schema.wallets.orgId, a.orgId));
  if (wallet && ship.sellPaise > 0) {
    await withLedger((s) => credit(s, { walletId: wallet.id, amount: ship.sellPaise, kind: "refund_credit", idempotencyKey: `refund:cancel:${ship.id}`, refType: "shipment", refId: ship.id, memo: `Refund: shipment cancelled${ship.awb ? ` · ${ship.awb}` : ""}` }));
  }
  return { ok: true, state: "cancelled", refundedPaise: ship.sellPaise, message: `Cancelled with ${ship.carrierName}; ${ship.sellPaise > 0 ? "shipping charge refunded to wallet" : "no charge to refund"}` };
}
