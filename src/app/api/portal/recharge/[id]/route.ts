import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { apiCustomer } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { apiError } from "@/server/http";
import { reconcileRecharge } from "@/server/payments/reconcile";
import { rateLimit } from "@/server/security/rate-limit";
import { rechargeStatus } from "@/lib/recharge";

/** Status / receipt of one of this account's recharges. Pending online payments are re-checked with the gateway. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const { id } = await params;
  const db = await getDb();
  const [own] = await db.select({ id: schema.recharges.id, status: schema.recharges.status }).from(schema.recharges).where(and(eq(schema.recharges.id, id), eq(schema.recharges.orgId, s.orgId)));
  if (!own) return apiError(404, "not_found", "Recharge not found");
  if (own.status === "payment_pending" && (await rateLimit(`rcrecon:${id}`, 20, 300)).ok) await reconcileRecharge(id);
  const [rc] = await db.select().from(schema.recharges).where(eq(schema.recharges.id, id));
  const [w] = await db.select({ balance: sql<number>`${schema.wallets.postedPaise} - ${schema.wallets.reservedPaise}` }).from(schema.wallets).where(eq(schema.wallets.orgId, s.orgId));
  return NextResponse.json({
    id: rc.id, requestNumber: rc.requestNumber, method: rc.method, status: rc.status, statusLabel: rechargeStatus(rc.status).label,
    creditPaise: rc.amountPaise, payablePaise: rc.payablePaise, discountPaise: rc.discountPaise, paidPaise: rc.paidPaise,
    reference: rc.razorpayPaymentId ?? rc.providerPaymentId ?? rc.utr ?? null, orderId: rc.razorpayOrderId ?? rc.providerOrderId ?? null,
    ticketId: rc.ticketId, decisionNote: rc.status === "rejected" || rc.status === "info_required" ? rc.decisionNote : null,
    createdAt: rc.createdAt, decidedAt: rc.decidedAt, balancePaise: w?.balance ?? null,
  });
}
