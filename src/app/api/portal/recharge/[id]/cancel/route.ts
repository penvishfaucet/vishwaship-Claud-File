import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { apiCustomer } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { apiError } from "@/server/http";
import { reconcileRecharge } from "@/server/payments/reconcile";
import { rechargeEvent } from "@/server/payments/recharge";
import { orderPayments } from "@/server/payments/razorpay";

/**
 * The customer closed checkout. First ask the gateway (a payment may have gone through just before closing):
 * captured → credited as usual; still nothing → Cancelled. A cancelled recharge is never money in the wallet, and a
 * late gateway confirmation still credits it (exactly once) through the normal settlement.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const { id } = await params;
  const db = await getDb();
  const [rc] = await db.select().from(schema.recharges).where(and(eq(schema.recharges.id, id), eq(schema.recharges.orgId, s.orgId)));
  if (!rc) return apiError(404, "not_found", "Recharge not found");
  if (rc.status !== "payment_pending") return NextResponse.json({ status: rc.status });
  const after = await reconcileRecharge(id);
  if (after !== "payment_pending") return NextResponse.json({ status: after });
  // a payment that is authorised but not yet captured is money on its way: keep it Pending, not Cancelled
  if (rc.method === "razorpay" && rc.razorpayOrderId) {
    const live = await orderPayments(rc.razorpayOrderId).catch(() => null);
    if (live === null || live.some((x) => x.status === "authorized" || x.status === "created")) return NextResponse.json({ status: "payment_pending" });
  }
  const upd = await db.update(schema.recharges).set({ status: "cancelled", updatedAt: new Date() }).where(and(eq(schema.recharges.id, id), eq(schema.recharges.status, "payment_pending"))).returning({ id: schema.recharges.id });
  if (upd.length) await rechargeEvent(id, "cancelled", "customer", s.userId, "Checkout closed without payment");
  return NextResponse.json({ status: upd.length ? "cancelled" : (await db.select({ st: schema.recharges.status }).from(schema.recharges).where(eq(schema.recharges.id, id)))[0]?.st });
}
