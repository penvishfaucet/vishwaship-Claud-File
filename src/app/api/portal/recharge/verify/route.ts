import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { apiCustomer } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { apiError, parseJson } from "@/server/http";
import { applyCapturedPayment, fetchPayment, verifyCheckoutSignature } from "@/server/payments/razorpay";

export async function POST(req: Request) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const p = await parseJson(req, z.object({ razorpay_payment_id: z.string().max(64), razorpay_order_id: z.string().max(64), razorpay_signature: z.string().max(128) }));
  if (!p.ok) return p.res;
  const db = await getDb();
  // The order must be one WE created for THIS org.
  const [rc] = await db.select().from(schema.recharges).where(and(eq(schema.recharges.razorpayOrderId, p.data.razorpay_order_id), eq(schema.recharges.orgId, s.orgId)));
  if (!rc) return apiError(404, "not_found", "Recharge not found");
  if (!(await verifyCheckoutSignature(p.data.razorpay_order_id, p.data.razorpay_payment_id, p.data.razorpay_signature))) {
    return apiError(400, "validation_error", "Payment signature could not be verified");
  }
  const payment = await fetchPayment(p.data.razorpay_payment_id);
  if (payment.order_id !== rc.razorpayOrderId) return apiError(400, "validation_error", "Payment does not belong to this recharge");
  const r = await applyCapturedPayment(payment, "checkout");
  if (!r.ok) return NextResponse.json({ error: { code: "pending", message: "Payment received; your wallet will update once Razorpay confirms capture." } }, { status: 202 });
  return NextResponse.json({ message: "Wallet recharged successfully." });
}
