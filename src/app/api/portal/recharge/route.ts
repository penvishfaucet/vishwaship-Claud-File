import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { apiCustomer } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db/client";
import { apiError, parseJson } from "@/server/http";
import { withLedger } from "@/server/ledger/db-store";
import { credit } from "@/server/ledger/wallet";
import { createCashfreeOrder } from "@/server/payments/cashfree";
import { rechargeEvent } from "@/server/payments/recharge";
import { createRazorpayOrder } from "@/server/payments/razorpay";
import { activeGateway, appUrl, getPaymentSettings, webhookUrl } from "@/server/payments/settings";
import { rateLimit } from "@/server/security/rate-limit";
import { newId } from "@/server/util/ids";
import { formatINR } from "@/lib/money";

/**
 * Start an ONLINE recharge with the gateway Admin selected (Razorpay or Cashfree). The wallet is credited
 * only after the payment is verified with the gateway (verify / webhook / reconcile). Manual UPI requests
 * use /api/portal/recharge/manual.
 */
export async function POST(req: Request) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const rl = await rateLimit(`recharge:${s.orgId}`, 10, 600);
  if (!rl.ok) return apiError(429, "rate_limited", "Too many recharge attempts — try again in a few minutes");
  const p = await parseJson(req, z.object({ amountRupees: z.number().int().positive().max(10_000_000), gateway: z.enum(["razorpay", "cashfree"]).optional() }));
  if (!p.ok) return p.res;
  const settings = await getPaymentSettings();
  const amountPaise = p.data.amountRupees * 100;
  if (amountPaise < settings.onlineMinPaise || amountPaise > settings.onlineMaxPaise) return apiError(422, "validation_error", `Enter an amount between ${formatINR(settings.onlineMinPaise)} and ${formatINR(settings.onlineMaxPaise)}`);
  const db = await getDb();
  const rechargeId = newId("rch");
  const gw = await activeGateway(p.data.gateway);
  if (p.data.gateway && gw && gw.gateway !== p.data.gateway) return apiError(409, "conflict", `${p.data.gateway === "razorpay" ? "Razorpay" : "Cashfree"} is not available right now. Refresh the page and choose another method.`);

  if (!gw) {
    // DEMO ONLY (no gateway connected, never in production): credits immediately and is labelled demo.
    if (process.env.NODE_ENV === "production") return apiError(503, "provider_error", "Online payment is not available right now. Use Manual UPI or try later.");
    await db.insert(schema.recharges).values({ id: rechargeId, orgId: s.orgId, amountPaise, method: "demo", status: "credited", razorpayOrderId: `demo_${rechargeId}`, paidPaise: amountPaise, payablePaise: amountPaise, decidedAt: new Date() });
    const [wallet] = await db.select().from(schema.wallets).where(eq(schema.wallets.orgId, s.orgId));
    await withLedger((st) => credit(st, { walletId: wallet.id, amount: amountPaise, kind: "recharge_credit", idempotencyKey: `recharge:${rechargeId}`, refType: "recharge", refId: rechargeId, memo: "Wallet recharge (DEMO — no real payment)" }));
    await rechargeEvent(rechargeId, "gateway_success", "system", s.userId, "Demo recharge (no gateway connected)");
    await audit({ actorUserId: s.userId, actorKind: "customer", orgId: s.orgId, action: "recharge.demo", targetType: "recharge", targetId: rechargeId, details: { amountPaise } });
    return NextResponse.json({ mode: "demo", rechargeId, amountPaise });
  }

  await db.insert(schema.recharges).values({ id: rechargeId, orgId: s.orgId, amountPaise, method: gw.gateway, status: "payment_pending", payablePaise: amountPaise });
  await rechargeEvent(rechargeId, "created", "customer", s.userId, `${gw.gateway} order for ${formatINR(amountPaise)}`);
  try {
    if (gw.gateway === "razorpay") {
      const order = await createRazorpayOrder(rechargeId, amountPaise);
      await db.update(schema.recharges).set({ razorpayOrderId: order.orderId, providerOrderId: order.orderId }).where(eq(schema.recharges.id, rechargeId));
      return NextResponse.json({ mode: "razorpay", rechargeId, razorpayOrderId: order.orderId, keyId: order.keyId, amountPaise });
    }
    const [u] = await db.select({ mobile: schema.users.mobile, email: schema.users.email, name: schema.users.name }).from(schema.users).where(eq(schema.users.id, s.userId));
    const phone = String(u?.mobile ?? "").replace(/\D/g, "").slice(-10);
    if (!/^[6-9]\d{9}$/.test(phone)) throw new Error("Add a valid mobile number to your profile to pay with Cashfree");
    const order = await createCashfreeOrder({ orderId: rechargeId, amountPaise, customerId: s.orgId, phone, email: u?.email, name: u?.name, returnUrl: `${appUrl()}/portal/billing/recharges/${rechargeId}/?from=cashfree`, notifyUrl: webhookUrl("cashfree") });
    await db.update(schema.recharges).set({ providerOrderId: rechargeId }).where(eq(schema.recharges.id, rechargeId));
    return NextResponse.json({ mode: "cashfree", rechargeId, paymentSessionId: order.paymentSessionId, cashfreeMode: order.mode, amountPaise });
  } catch (e) {
    await db.update(schema.recharges).set({ status: "failed", updatedAt: new Date() }).where(eq(schema.recharges.id, rechargeId));
    await rechargeEvent(rechargeId, "gateway_failed", "system", null, (e as Error).message);
    return apiError(502, "provider_error", (e as Error).message);
  }
}
