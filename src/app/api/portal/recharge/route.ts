import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { apiCustomer } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db/client";
import { apiError, parseJson } from "@/server/http";
import { withLedger } from "@/server/ledger/db-store";
import { credit } from "@/server/ledger/wallet";
import { createRazorpayOrder, razorpayAccount } from "@/server/payments/razorpay";
import { rateLimit } from "@/server/security/rate-limit";
import { newId } from "@/server/util/ids";

export async function POST(req: Request) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const rl = await rateLimit(`recharge:${s.orgId}`, 10, 600);
  if (!rl.ok) return apiError(429, "rate_limited", "Too many recharge attempts");
  const p = await parseJson(req, z.object({ amountRupees: z.number().int().min(100).max(200000) }));
  if (!p.ok) return p.res;
  const amountPaise = p.data.amountRupees * 100;
  const db = await getDb();
  const rechargeId = newId("rch");
  const rz = await razorpayAccount();

  if (!rz) {
    // DEMO ONLY: Razorpay not connected. Disabled in production builds.
    if (process.env.NODE_ENV === "production") return apiError(503, "provider_error", "Payments are not configured yet");
    await db.insert(schema.recharges).values({ id: rechargeId, orgId: s.orgId, amountPaise, status: "captured", razorpayOrderId: `demo_${rechargeId}` });
    const [wallet] = await db.select().from(schema.wallets).where(eq(schema.wallets.orgId, s.orgId));
    await withLedger((st) => credit(st, { walletId: wallet.id, amount: amountPaise, kind: "recharge_credit", idempotencyKey: `demo:${rechargeId}`, refType: "recharge", refId: rechargeId, memo: "Wallet recharge (DEMO — no real payment)" }));
    await audit({ actorUserId: s.userId, actorKind: "customer", orgId: s.orgId, action: "recharge.demo", targetType: "recharge", targetId: rechargeId, details: { amountPaise } });
    return NextResponse.json({ mode: "demo", amountPaise });
  }

  await db.insert(schema.recharges).values({ id: rechargeId, orgId: s.orgId, amountPaise, status: "pending" });
  const order = await createRazorpayOrder(rechargeId, amountPaise);
  await db.update(schema.recharges).set({ razorpayOrderId: order.orderId }).where(eq(schema.recharges.id, rechargeId));
  return NextResponse.json({ mode: "razorpay", razorpayOrderId: order.orderId, keyId: order.keyId, amountPaise });
}
