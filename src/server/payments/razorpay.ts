import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { hmacSha256Hex, safeEqual } from "@/server/security/crypto";
import { gatewayFor } from "./settings";
import { settleOnline } from "./recharge";

/**
 * Razorpay — https://razorpay.com/docs/api/orders/ · /docs/payments/server-integration/nodejs/integration-steps/
 *  - Orders API creates the order; Standard Checkout (checkout.js) collects the payment.
 *  - Checkout handler signature = HMAC_SHA256(order_id + "|" + payment_id, key_secret) (hex).
 *  - Webhook X-Razorpay-Signature = HMAC_SHA256(raw body, webhook secret) (hex); dedupe on X-Razorpay-Event-Id.
 *  - The payment is always re-fetched from the API before money moves.
 * Secrets in provider_accounts.secretsEnc: { keyId, keySecret, webhookSecret }.
 */
async function rz() {
  const g = await gatewayFor("razorpay");
  if (!g || !g.secrets.keyId || !g.secrets.keySecret) throw new Error("Razorpay is not configured");
  const auth = `Basic ${Buffer.from(`${g.secrets.keyId}:${g.secrets.keySecret}`).toString("base64")}`;
  return { g, auth };
}

/** Kept for existing callers: the enabled Razorpay account (or null). */
export async function razorpayAccount() {
  const g = await gatewayFor("razorpay");
  return g && g.acct.status === "enabled" && g.secrets.keyId && g.secrets.keySecret ? { acct: g.acct, ctx: g.ctx } : null;
}

export async function createRazorpayOrder(rechargeId: string, amountPaise: number) {
  const { g, auth } = await rz();
  const r = await g.ctx.fetch("https://api.razorpay.com/v1/orders", {
    method: "POST", timeoutMs: 15_000, headers: { authorization: auth, "content-type": "application/json" },
    body: JSON.stringify({ amount: amountPaise, currency: "INR", receipt: rechargeId, notes: { recharge_id: rechargeId } }),
  });
  if (!r.ok) throw new Error(`Razorpay order failed (${r.status})`);
  const j = (await r.json()) as { id: string };
  return { orderId: j.id, keyId: g.secrets.keyId };
}

export async function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string) {
  const g = await gatewayFor("razorpay");
  if (!g?.secrets.keySecret) return false;
  return safeEqual(hmacSha256Hex(g.secrets.keySecret, `${orderId}|${paymentId}`), signature);
}

export async function verifyWebhookSignature(rawBody: string, signature: string | null) {
  const g = await gatewayFor("razorpay");
  if (!g || !signature || !g.secrets.webhookSecret) return false;
  return safeEqual(hmacSha256Hex(g.secrets.webhookSecret, rawBody), signature);
}

export type RzPayment = { id: string; order_id: string; amount: number; currency: string; status: string };

export async function fetchPayment(paymentId: string): Promise<RzPayment> {
  const { g, auth } = await rz();
  const r = await g.ctx.fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, { headers: { authorization: auth }, timeoutMs: 15_000 });
  if (!r.ok) throw new Error(`Razorpay payment lookup failed (${r.status})`);
  return (await r.json()) as RzPayment;
}

/** Payments made against an order — used to reconcile when the customer closed checkout after paying. */
export async function orderPayments(orderId: string): Promise<RzPayment[]> {
  const { g, auth } = await rz();
  const r = await g.ctx.fetch(`https://api.razorpay.com/v1/orders/${encodeURIComponent(orderId)}/payments`, { headers: { authorization: auth }, timeoutMs: 15_000 });
  if (!r.ok) throw new Error(`Razorpay order lookup failed (${r.status})`);
  return ((await r.json()) as { items?: RzPayment[] }).items ?? [];
}

/** Credit a captured Razorpay payment exactly once (checkout callback, webhook and reconcile may all arrive). */
export async function applyCapturedPayment(p: RzPayment, source: "checkout" | "webhook" | "reconcile") {
  const db = await getDb();
  const [rc] = await db.select().from(schema.recharges).where(eq(schema.recharges.razorpayOrderId, p.order_id));
  if (!rc) return { ok: false as const, reason: "unknown_order" };
  return settleOnline(rc.id, { paymentId: p.id, amountPaise: p.amount, currency: p.currency, outcome: p.status === "captured" ? "success" : p.status === "failed" ? "failed" : "pending", source });
}

/** Re-check an order's payments with Razorpay and settle the recharge. */
export async function reconcileRazorpay(orderId: string) {
  const list = await orderPayments(orderId);
  const ok = list.find((x) => x.status === "captured");
  if (ok) return applyCapturedPayment(ok, "reconcile");
  const authorised = list.find((x) => x.status === "authorized");
  if (authorised) return { ok: false as const, reason: "payment_authorized" };
  if (list.length && list.every((x) => x.status === "failed")) return applyCapturedPayment(list[list.length - 1], "reconcile");
  return { ok: false as const, reason: "no_payment" };
}

export async function testRazorpay(): Promise<{ ok: boolean; message: string }> {
  try {
    const { g, auth } = await rz();
    const r = await g.ctx.fetch("https://api.razorpay.com/v1/orders?count=1", { headers: { authorization: auth }, timeoutMs: 10_000 });
    if (r.ok) return { ok: true, message: `Connected to Razorpay (${g.secrets.keyId.startsWith("rzp_live_") ? "live" : "test"} keys)` };
    if (r.status === 401) return { ok: false, message: "Razorpay rejected the Key ID / Key Secret" };
    return { ok: false, message: `Razorpay responded ${r.status}` };
  } catch (e) { return { ok: false, message: (e as Error).message }; }
}
