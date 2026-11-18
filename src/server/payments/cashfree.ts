import "server-only";
import { createHmac } from "node:crypto";
import { safeEqual } from "@/server/security/crypto";
import { gatewayFor } from "./settings";

/**
 * Cashfree Payment Gateway (PG) — https://www.cashfree.com/docs/api-reference/payments/latest
 *  - Create Order: POST {base}/pg/orders → payment_session_id (opened with the JS SDK v3 cashfree.checkout()).
 *  - Verify: GET {base}/pg/orders/{order_id}/payments → payment_status SUCCESS (source of truth before crediting).
 *  - Webhook: x-webhook-signature = base64(HMAC-SHA256(timestamp + rawBody, client secret)), x-webhook-timestamp.
 * Auth headers: x-client-id, x-client-secret, x-api-version. Secrets in provider_accounts: { clientId, clientSecret }.
 */
export const CASHFREE_API_VERSION = "2026-01-01";
const base = (mode: string) => (mode === "live" ? "https://api.cashfree.com" : "https://sandbox.cashfree.com");

async function cf() {
  const g = await gatewayFor("cashfree");
  if (!g || !g.secrets.clientId || !g.secrets.clientSecret) throw new Error("Cashfree is not configured");
  const headers = { "x-client-id": g.secrets.clientId, "x-client-secret": g.secrets.clientSecret, "x-api-version": CASHFREE_API_VERSION, "content-type": "application/json", accept: "application/json" };
  return { g, headers, base: base(g.acct.mode), mode: g.acct.mode };
}

export async function createCashfreeOrder(a: { orderId: string; amountPaise: number; customerId: string; phone: string; email?: string | null; name?: string; returnUrl: string; notifyUrl: string }) {
  const c = await cf();
  const r = await c.g.ctx.fetch(`${c.base}/pg/orders`, {
    method: "POST", timeoutMs: 15_000,
    headers: { ...c.headers, "x-idempotency-key": a.orderId },
    body: JSON.stringify({
      order_id: a.orderId, order_amount: Number((a.amountPaise / 100).toFixed(2)), order_currency: "INR",
      customer_details: { customer_id: a.customerId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 50), customer_phone: a.phone, customer_email: a.email || undefined, customer_name: a.name || undefined },
      order_meta: { return_url: a.returnUrl, notify_url: a.notifyUrl },
      order_note: "Vishwaship wallet recharge",
    }),
  });
  const j = (await r.json().catch(() => ({}))) as { payment_session_id?: string; order_status?: string; message?: string };
  if (!r.ok || !j.payment_session_id) throw new Error(`Cashfree order failed (${r.status})${j.message ? `: ${j.message}` : ""}`);
  return { paymentSessionId: j.payment_session_id, mode: c.mode === "live" ? "production" : "sandbox" };
}

export interface CashfreePayment { cf_payment_id: string | number; payment_status: string; payment_amount: number; payment_currency: string; order_id: string; payment_time?: string; bank_reference?: string }

/** All payments of an order (source of truth). */
export async function cashfreePayments(orderId: string): Promise<CashfreePayment[]> {
  const c = await cf();
  const r = await c.g.ctx.fetch(`${c.base}/pg/orders/${encodeURIComponent(orderId)}/payments`, { headers: c.headers, timeoutMs: 15_000 });
  if (r.status === 404) return [];
  if (!r.ok) throw new Error(`Cashfree payment lookup failed (${r.status})`);
  const j = await r.json();
  return Array.isArray(j) ? (j as CashfreePayment[]) : [];
}

export async function cashfreeOrderStatus(orderId: string): Promise<string | null> {
  const c = await cf();
  const r = await c.g.ctx.fetch(`${c.base}/pg/orders/${encodeURIComponent(orderId)}`, { headers: c.headers, timeoutMs: 15_000 });
  if (!r.ok) return null;
  return ((await r.json()) as { order_status?: string }).order_status ?? null;
}

/**
 * Webhook signature. Cashfree documents the signed string as timestamp + raw body; the docs' pseudocode
 * also shows a "." separator, so both forms are accepted (both need the secret key).
 */
export async function verifyCashfreeWebhook(rawBody: string, timestamp: string | null, signature: string | null) {
  if (!timestamp || !signature) return false;
  const g = await gatewayFor("cashfree");
  const secret = g?.secrets.clientSecret;
  if (!secret) return false;
  const sig = (s: string) => createHmac("sha256", secret).update(s).digest("base64");
  return safeEqual(sig(timestamp + rawBody), signature) || safeEqual(sig(`${timestamp}.${rawBody}`), signature);
}

/** Connection test: a valid key gets 404 for an unknown order; a bad key gets 401/403. */
export async function testCashfree(): Promise<{ ok: boolean; message: string }> {
  try {
    const c = await cf();
    const r = await c.g.ctx.fetch(`${c.base}/pg/orders/vs_conn_test_${Date.now()}`, { headers: c.headers, timeoutMs: 10_000 });
    if (r.status === 404 || r.ok) return { ok: true, message: `Connected to Cashfree ${c.mode === "live" ? "production" : "sandbox"}` };
    if (r.status === 401 || r.status === 403) return { ok: false, message: "Cashfree rejected the App ID / Secret Key" };
    return { ok: false, message: `Cashfree responded ${r.status}` };
  } catch (e) { return { ok: false, message: (e as Error).message }; }
}
