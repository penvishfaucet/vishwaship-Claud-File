import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { audit } from "@/server/audit";
import { withLedger } from "@/server/ledger/db-store";
import { credit } from "@/server/ledger/wallet";
import { hmacSha256Hex, safeEqual } from "@/server/security/crypto";
import { providerContext } from "@/server/providers/registry";

/**
 * Razorpay (https://razorpay.com/docs/api/orders/, /docs/webhooks/validate-test/).
 * Secrets in provider_accounts.secretsEnc: { keyId, keySecret, webhookSecret }.
 */
export async function razorpayAccount() {
  const db = await getDb();
  const [acct] = await db.select().from(schema.providerAccounts).where(and(eq(schema.providerAccounts.adapter, "razorpay"), eq(schema.providerAccounts.status, "enabled")));
  if (!acct) return null;
  const ctx = await providerContext({ ...acct, configPublic: { allowedHosts: ["api.razorpay.com"] } });
  return { acct, ctx };
}

export async function createRazorpayOrder(rechargeId: string, amountPaise: number) {
  const a = await razorpayAccount();
  if (!a) throw new Error("Razorpay is not configured");
  const auth = Buffer.from(`${a.ctx.secrets.keyId}:${a.ctx.secrets.keySecret}`).toString("base64");
  const r = await a.ctx.fetch("https://api.razorpay.com/v1/orders", {
    method: "POST", headers: { authorization: `Basic ${auth}`, "content-type": "application/json" },
    body: JSON.stringify({ amount: amountPaise, currency: "INR", receipt: rechargeId, notes: { recharge_id: rechargeId } }),
  });
  if (!r.ok) throw new Error(`Razorpay order failed (${r.status})`);
  const j = (await r.json()) as { id: string; amount: number; currency: string };
  return { orderId: j.id, keyId: a.ctx.secrets.keyId };
}

/** Checkout handler signature: HMAC_SHA256(order_id + "|" + payment_id, key_secret). */
export async function verifyCheckoutSignature(orderId: string, paymentId: string, signature: string) {
  const a = await razorpayAccount();
  if (!a) return false;
  return safeEqual(hmacSha256Hex(a.ctx.secrets.keySecret, `${orderId}|${paymentId}`), signature);
}

/** Webhook signature: HMAC_SHA256(raw body, webhook_secret) in X-Razorpay-Signature. */
export async function verifyWebhookSignature(rawBody: string, signature: string | null) {
  const a = await razorpayAccount();
  if (!a || !signature || !a.ctx.secrets.webhookSecret) return false;
  return safeEqual(hmacSha256Hex(a.ctx.secrets.webhookSecret, rawBody), signature);
}

/** Fetch the payment from Razorpay (source of truth) before crediting. */
export async function fetchPayment(paymentId: string) {
  const a = await razorpayAccount();
  if (!a) throw new Error("Razorpay is not configured");
  const auth = Buffer.from(`${a.ctx.secrets.keyId}:${a.ctx.secrets.keySecret}`).toString("base64");
  const r = await a.ctx.fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, { headers: { authorization: `Basic ${auth}` } });
  if (!r.ok) throw new Error(`Razorpay payment lookup failed (${r.status})`);
  return (await r.json()) as { id: string; order_id: string; amount: number; currency: string; status: string };
}

/**
 * Credit a captured payment exactly once. Safe for duplicate/out-of-order callbacks (verify call
 * and webhook can both arrive): ledger idempotency key = razorpay payment id.
 */
export async function applyCapturedPayment(p: { id: string; order_id: string; amount: number; currency: string; status: string }, source: "checkout" | "webhook" | "reconcile") {
  const db = await getDb();
  const [rc] = await db.select().from(schema.recharges).where(eq(schema.recharges.razorpayOrderId, p.order_id));
  if (!rc) return { ok: false as const, reason: "unknown_order" };
  if (p.status !== "captured") return { ok: false as const, reason: `payment_${p.status}` };
  if (p.currency !== "INR" || p.amount !== rc.amountPaise) {
    await db.update(schema.recharges).set({ status: "mismatch", razorpayPaymentId: p.id, updatedAt: new Date() }).where(eq(schema.recharges.id, rc.id));
    await audit({ actorKind: "system", orgId: rc.orgId, action: "recharge.mismatch", targetType: "recharge", targetId: rc.id, details: { expected: rc.amountPaise, got: p.amount, currency: p.currency } });
    return { ok: false as const, reason: "amount_mismatch" };
  }
  const [wallet] = await db.select().from(schema.wallets).where(eq(schema.wallets.orgId, rc.orgId));
  const r = await withLedger((s) => credit(s, { walletId: wallet.id, amount: rc.amountPaise, kind: "recharge_credit", idempotencyKey: `rzp:${p.id}`, refType: "recharge", refId: rc.id, memo: "Wallet recharge (Razorpay)" }));
  await db.update(schema.recharges).set({ status: "captured", razorpayPaymentId: p.id, updatedAt: new Date() }).where(eq(schema.recharges.id, rc.id));
  if (!r.replayed) {
    await db.insert(schema.inAppAlerts).values({ id: `al_${p.id}`, orgId: rc.orgId, kind: "wallet", title: `Wallet recharged with ₹${(rc.amountPaise / 100).toFixed(2)}`, href: "/portal/billing/" }).onConflictDoNothing();
    await audit({ actorKind: "system", orgId: rc.orgId, action: "recharge.credited", targetType: "recharge", targetId: rc.id, details: { source, paymentId: p.id } });
  }
  return { ok: true as const, replayed: r.replayed, amountPaise: rc.amountPaise };
}
