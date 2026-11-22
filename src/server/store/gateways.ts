import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { orgSetting, saveOrgSetting } from "@/server/couriers";
import { getDb, schema } from "@/server/db/client";
import { decryptJson, encryptJson, maskSecret } from "@/server/security/crypto";
import { safeFetch } from "@/server/security/safe-fetch";

/**
 * The MERCHANT's own Cashfree / PhonePe / Paytm account for store checkout (Razorpay lives in razorpay.ts).
 * Money settles to the merchant, never to Vishwaship. Keys are stored encrypted per org; pages see masked hints only.
 * A gateway is offered at checkout only after a live call with the keys succeeded.
 *
 * Payment is never trusted from the browser or a callback: after the buyer returns (or in the background sweep)
 * we ask the gateway's own status API whether the order is paid, for the full amount.
 */
export const GATEWAYS = {
  cashfree: { label: "Cashfree", fields: [{ key: "appId", label: "App ID", secret: false }, { key: "secretKey", label: "Secret key", secret: true }] },
  phonepe: { label: "PhonePe Business", fields: [{ key: "clientId", label: "Client ID", secret: false }, { key: "clientVersion", label: "Client version", secret: false }, { key: "clientSecret", label: "Client secret", secret: true }] },
  paytm: { label: "Paytm Business", fields: [{ key: "mid", label: "Merchant ID (MID)", secret: false }, { key: "merchantKey", label: "Merchant key", secret: true }] },
} as const;
export type GatewayKey = keyof typeof GATEWAYS;
export const GATEWAY_KEYS = Object.keys(GATEWAYS) as GatewayKey[];
export const isGatewayKey = (k: string): k is GatewayKey => k in GATEWAYS;

type Mode = "test" | "live";
type Secrets = Record<string, string>;
type Stored = { secretsEnc: string; hints: Record<string, string>; mode: Mode; verified: boolean; lastTestAt: string | null; lastTestMessage: string | null };
const settingKey = (g: GatewayKey) => `store_pg_${g}`;

const HOSTS: Record<GatewayKey, Record<Mode, string>> = {
  cashfree: { test: "sandbox.cashfree.com", live: "api.cashfree.com" },
  phonepe: { test: "api-preprod.phonepe.com", live: "api.phonepe.com" },
  paytm: { test: "securestage.paytmpayments.com", live: "secure.paytmpayments.com" },
};
const CASHFREE_VERSION = "2026-01-01";

/** Test hook: lets tests replace the network. */
let fetcher: (url: string, init: RequestInit & { timeoutMs?: number; allowedHosts?: string[] }) => Promise<Response> = safeFetch;
export const __setGatewayFetch = (f: typeof fetcher) => { fetcher = f; };
const call = (g: GatewayKey, mode: Mode, path: string, init: RequestInit = {}) => {
  const host = HOSTS[g][mode];
  return fetcher(`https://${host}${path}`, { ...init, timeoutMs: 15_000, allowedHosts: [host] });
};

async function load(orgId: string, g: GatewayKey): Promise<{ s: Secrets; stored: Stored } | null> {
  const stored = await orgSetting<Stored>(orgId, settingKey(g));
  if (!stored) return null;
  return { s: decryptJson<Secrets>(stored.secretsEnc), stored };
}

export async function gatewayOverview(orgId: string) {
  const out: Partial<Record<GatewayKey, { hints: Record<string, string>; mode: Mode; verified: boolean; lastTestAt: string | null; lastTestMessage: string | null }>> = {};
  for (const g of GATEWAY_KEYS) {
    const st = await orgSetting<Stored>(orgId, settingKey(g));
    if (st) out[g] = { hints: st.hints, mode: st.mode, verified: st.verified, lastTestAt: st.lastTestAt, lastTestMessage: st.lastTestMessage };
  }
  return out;
}

export async function readyGateways(orgId: string): Promise<GatewayKey[]> {
  const out: GatewayKey[] = [];
  for (const g of GATEWAY_KEYS) if ((await orgSetting<Stored>(orgId, settingKey(g)))?.verified) out.push(g);
  return out;
}

const FORMAT: Record<string, RegExp> = {
  appId: /^[A-Za-z0-9_-]{6,80}$/, secretKey: /^\S{10,200}$/,
  clientId: /^[A-Za-z0-9_-]{4,80}$/, clientVersion: /^\d{1,4}$/, clientSecret: /^\S{8,200}$/,
  mid: /^[A-Za-z0-9]{6,40}$/, merchantKey: /^\S{16}$/,
};

/** Save keys (blank secrets keep the stored ones when the public id is unchanged), then test them live. */
export async function saveGatewayKeys(orgId: string, userId: string, g: GatewayKey, mode: Mode, input: Record<string, string>) {
  const old = await load(orgId, g);
  const next: Secrets = {};
  for (const f of GATEWAYS[g].fields) {
    let v = (input[f.key] ?? "").trim();
    const samePublic = old && GATEWAYS[g].fields.filter((x) => !x.secret).every((x) => (input[x.key] ?? "").trim() === old.s[x.key]);
    if (!v && f.secret && samePublic) v = old!.s[f.key];
    if (!FORMAT[f.key].test(v)) return { ok: false as const, message: f.key === "merchantKey" ? "Paytm merchant key is 16 characters" : `Enter a valid ${f.label}` };
    next[f.key] = v;
  }
  const hints: Record<string, string> = {};
  for (const f of GATEWAYS[g].fields) hints[f.key] = f.secret ? maskSecret(next[f.key]) : next[f.key];
  await saveOrgSetting(orgId, settingKey(g), { secretsEnc: encryptJson(next), hints, mode, verified: false, lastTestAt: null, lastTestMessage: null } satisfies Stored, userId);
  return testGateway(orgId, g, userId);
}

export async function removeGateway(orgId: string, g: GatewayKey) {
  const db = await getDb();
  await db.delete(schema.orgSettings).where(and(eq(schema.orgSettings.orgId, orgId), eq(schema.orgSettings.key, settingKey(g))));
}

export async function testGateway(orgId: string, g: GatewayKey, userId?: string) {
  const k = await load(orgId, g);
  if (!k) return { ok: false as const, message: "Add your keys first" };
  const name = GATEWAYS[g].label;
  let ok = false, message = "";
  try {
    if (g === "cashfree") {
      // a lookup of an order that can't exist: 404 means the keys were accepted, 401/403 means they were not
      const r = await call(g, k.stored.mode, `/pg/orders/vsconn${randomBytes(6).toString("hex")}`, { headers: cfHeaders(k.s) });
      ok = r.status === 404 || r.ok;
      message = ok ? `Connected (${k.stored.mode} mode)` : r.status === 401 || r.status === 403 ? `${name} rejected these keys. Check App ID, secret key and the mode.` : `${name} returned ${r.status}. Try again later.`;
    } else if (g === "phonepe") {
      await phonepeToken(orgId, k.s, k.stored.mode, true);
      ok = true; message = `Connected (${k.stored.mode} mode)`;
    } else {
      // a ₹1 transaction token that is never used proves the MID and key work together
      const r = await paytmInitiate(k.s, k.stored.mode, { orderId: `VSCONN${randomBytes(6).toString("hex")}`, amountPaise: 100, custId: "vsconn", callbackUrl: "https://vishwaship.in/" });
      ok = !!r.txnToken;
      message = ok ? `Connected (${k.stored.mode} mode)` : `${name} rejected these keys: ${r.message}`;
    }
  } catch (e) {
    message = e instanceof GatewayAuthError ? `${name} rejected these keys. Check them and the mode.` : `Could not reach ${name}. Try again in a minute.`;
  }
  await saveOrgSetting(orgId, settingKey(g), { ...k.stored, verified: ok, lastTestAt: new Date().toISOString(), lastTestMessage: message }, userId);
  return ok ? { ok: true as const, message } : { ok: false as const, message };
}

class GatewayAuthError extends Error {}

// ---------------- Cashfree ----------------
const cfHeaders = (s: Secrets) => ({ "x-client-id": s.appId, "x-client-secret": s.secretKey, "x-api-version": CASHFREE_VERSION, "content-type": "application/json" });

// ---------------- PhonePe (OAuth client credentials, token cached until shortly before expiry) ----------------
const ppTokens = new Map<string, { token: string; until: number }>();
async function phonepeToken(orgId: string, s: Secrets, mode: Mode, fresh = false) {
  const ck = `${orgId}:${s.clientId}:${mode}`;
  const hit = ppTokens.get(ck);
  if (!fresh && hit && hit.until > Date.now() + 60_000) return hit.token;
  const path = mode === "live" ? "/apis/identity-manager/v1/oauth/token" : "/apis/pg-sandbox/v1/oauth/token";
  const r = await call("phonepe", mode, path, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: s.clientId, client_version: s.clientVersion, client_secret: s.clientSecret, grant_type: "client_credentials" }).toString(),
  });
  if (r.status === 400 || r.status === 401 || r.status === 403) throw new GatewayAuthError("auth");
  if (!r.ok) throw new Error(`PhonePe token ${r.status}`);
  const j = (await r.json()) as { access_token?: string; expires_at?: number };
  if (!j.access_token) throw new GatewayAuthError("auth");
  ppTokens.set(ck, { token: j.access_token, until: (j.expires_at ?? Math.floor(Date.now() / 1000) + 600) * 1000 });
  return j.access_token;
}
const ppBase = (mode: Mode) => (mode === "live" ? "/apis/pg" : "/apis/pg-sandbox");

// ---------------- Paytm (checksum = AES-128-CBC over sha256(body|salt)+salt, as in Paytm's official library) ----------------
const PAYTM_IV = "@@@@&&&&####$$$$";
export function paytmSignature(body: string, key: string, salt = randomBytes(3).toString("base64")) {
  const hash = createHash("sha256").update(`${body}|${salt}`).digest("hex") + salt;
  const c = createCipheriv("aes-128-cbc", Buffer.from(key, "utf8"), Buffer.from(PAYTM_IV, "utf8"));
  return c.update(hash, "utf8", "base64") + c.final("base64");
}
export function paytmVerify(body: string, key: string, signature: string) {
  try {
    const d = createDecipheriv("aes-128-cbc", Buffer.from(key, "utf8"), Buffer.from(PAYTM_IV, "utf8"));
    const plain = d.update(signature, "base64", "utf8") + d.final("utf8");
    const salt = plain.slice(-4);
    return createHash("sha256").update(`${body}|${salt}`).digest("hex") + salt === plain;
  } catch { return false; }
}
const rupeeStr = (paise: number) => (paise / 100).toFixed(2);

async function paytmInitiate(s: Secrets, mode: Mode, a: { orderId: string; amountPaise: number; custId: string; callbackUrl: string; mobile?: string }) {
  const body = {
    requestType: "Payment", mid: s.mid, websiteName: mode === "live" ? "DEFAULT" : "WEBSTAGING", orderId: a.orderId, callbackUrl: a.callbackUrl,
    txnAmount: { value: rupeeStr(a.amountPaise), currency: "INR" }, userInfo: { custId: a.custId, ...(a.mobile ? { mobile: a.mobile } : {}) },
  };
  const raw = JSON.stringify(body);
  const r = await call("paytm", mode, `/theia/api/v1/initiateTransaction?mid=${encodeURIComponent(s.mid)}&orderId=${encodeURIComponent(a.orderId)}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: `{"body":${raw},"head":{"signature":${JSON.stringify(paytmSignature(raw, s.merchantKey))}}}`,
  });
  if (!r.ok) throw new Error(`Paytm initiate ${r.status}`);
  const j = (await r.json()) as { body?: { resultInfo?: { resultStatus?: string; resultMsg?: string; txnToken?: string }; txnToken?: string } };
  const ri = j.body?.resultInfo;
  const token = ri?.txnToken ?? j.body?.txnToken;
  return ri?.resultStatus === "S" && token ? { txnToken: token, message: "ok" } : { txnToken: null, message: ri?.resultMsg ?? "Payment could not be started" };
}

// ---------------- the gateway-neutral surface used by checkout ----------------
export type GatewayStart =
  | { gateway: "cashfree"; mode: Mode; sessionId: string }
  | { gateway: "phonepe"; redirectUrl: string }
  | { gateway: "paytm"; action: string; fields: Record<string, string> };

export const newPgOrderId = (orderNumber: string) => `${orderNumber.replace(/[^A-Za-z0-9]/g, "").slice(0, 20)}_${randomBytes(5).toString("hex")}`;

/** Start a payment at the gateway for one store order. `returnUrl` is where the buyer comes back to (GET or POST). */
export async function startGatewayPayment(orgId: string, g: GatewayKey, a: { pgOrderId: string; amountPaise: number; buyer: { name: string; mobile: string; email: string }; returnUrl: string }): Promise<GatewayStart> {
  const k = await load(orgId, g);
  if (!k?.stored.verified) throw new Error("Online payments are not set up for this store");
  const mode = k.stored.mode;
  if (g === "cashfree") {
    const r = await call(g, mode, "/pg/orders", {
      method: "POST", headers: cfHeaders(k.s),
      body: JSON.stringify({
        order_id: a.pgOrderId, order_amount: Number(rupeeStr(a.amountPaise)), order_currency: "INR",
        customer_details: { customer_id: `c${a.buyer.mobile}`, customer_phone: a.buyer.mobile, customer_name: a.buyer.name.slice(0, 100), ...(a.buyer.email ? { customer_email: a.buyer.email } : {}) },
        order_meta: { return_url: a.returnUrl }, order_expiry_time: new Date(Date.now() + 35 * 60_000).toISOString(),
      }),
    });
    if (!r.ok) throw new Error(`Cashfree order ${r.status}`);
    const j = (await r.json()) as { payment_session_id?: string };
    if (!j.payment_session_id) throw new Error("Cashfree returned no session");
    return { gateway: "cashfree", mode, sessionId: j.payment_session_id };
  }
  if (g === "phonepe") {
    const token = await phonepeToken(orgId, k.s, mode);
    const r = await call(g, mode, `${ppBase(mode)}/checkout/v2/pay`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `O-Bearer ${token}` },
      body: JSON.stringify({ merchantOrderId: a.pgOrderId, amount: a.amountPaise, expireAfter: 1800, paymentFlow: { type: "PG_CHECKOUT", merchantUrls: { redirectUrl: a.returnUrl } } }),
    });
    if (!r.ok) throw new Error(`PhonePe pay ${r.status}`);
    const j = (await r.json()) as { redirectUrl?: string };
    if (!j.redirectUrl || !/^https:\/\//.test(j.redirectUrl)) throw new Error("PhonePe returned no payment page");
    return { gateway: "phonepe", redirectUrl: j.redirectUrl };
  }
  const init = await paytmInitiate(k.s, mode, { orderId: a.pgOrderId, amountPaise: a.amountPaise, custId: `c${a.buyer.mobile}`, mobile: a.buyer.mobile, callbackUrl: a.returnUrl });
  if (!init.txnToken) throw new Error(`Paytm: ${init.message}`);
  const host = HOSTS.paytm[mode];
  return { gateway: "paytm", action: `https://${host}/theia/api/v1/showPaymentPage?mid=${encodeURIComponent(k.s.mid)}&orderId=${encodeURIComponent(a.pgOrderId)}`, fields: { mid: k.s.mid, orderId: a.pgOrderId, txnToken: init.txnToken } };
}

export type GatewayStatus = { state: "paid" | "failed" | "pending"; amountPaise: number | null; paymentId: string | null };

/** Ask the gateway whether this order is paid. Network or auth problems throw (callers retry later, never cancel). */
export async function gatewayStatus(orgId: string, g: GatewayKey, pgOrderId: string): Promise<GatewayStatus> {
  const k = await load(orgId, g);
  if (!k) throw new Error("Gateway not configured");
  const mode = k.stored.mode;
  if (g === "cashfree") {
    const r = await call(g, mode, `/pg/orders/${encodeURIComponent(pgOrderId)}`, { headers: cfHeaders(k.s) });
    if (r.status === 404) return { state: "pending", amountPaise: null, paymentId: null };
    if (!r.ok) throw new Error(`Cashfree status ${r.status}`);
    const j = (await r.json()) as { order_status?: string; order_amount?: number; cf_order_id?: string | number };
    const amt = typeof j.order_amount === "number" ? Math.round(j.order_amount * 100) : null;
    return { state: j.order_status === "PAID" ? "paid" : j.order_status === "EXPIRED" || j.order_status === "TERMINATED" ? "failed" : "pending", amountPaise: amt, paymentId: j.cf_order_id != null ? `cf_${j.cf_order_id}` : null };
  }
  if (g === "phonepe") {
    const token = await phonepeToken(orgId, k.s, mode);
    const r = await call(g, mode, `${ppBase(mode)}/checkout/v2/order/${encodeURIComponent(pgOrderId)}/status?details=false`, { headers: { "content-type": "application/json", authorization: `O-Bearer ${token}` } });
    if (!r.ok) throw new Error(`PhonePe status ${r.status}`);
    const j = (await r.json()) as { state?: string; amount?: number | string; paymentDetails?: Array<{ transactionId?: string; state?: string }> };
    const paid = j.paymentDetails?.find((p) => p.state === "COMPLETED");
    return { state: j.state === "COMPLETED" ? "paid" : j.state === "FAILED" ? "failed" : "pending", amountPaise: j.amount != null ? Number(j.amount) : null, paymentId: paid?.transactionId ?? null };
  }
  const raw = JSON.stringify({ mid: k.s.mid, orderId: pgOrderId });
  const r = await call(g, mode, "/v3/order/status", { method: "POST", headers: { "content-type": "application/json" }, body: `{"body":${raw},"head":{"signature":${JSON.stringify(paytmSignature(raw, k.s.merchantKey))}}}` });
  if (!r.ok) throw new Error(`Paytm status ${r.status}`);
  const j = (await r.json()) as { body?: { resultInfo?: { resultStatus?: string }; txnAmount?: string; txnId?: string } };
  const st = j.body?.resultInfo?.resultStatus;
  return { state: st === "TXN_SUCCESS" ? "paid" : st === "TXN_FAILURE" ? "failed" : "pending", amountPaise: j.body?.txnAmount ? Math.round(Number(j.body.txnAmount) * 100) : null, paymentId: j.body?.txnId ?? null };
}

// ---------------- refunds (full amount back to the buyer on the merchant's account) ----------------
export type GwRefund = { id: string | null; status: "pending" | "processed" | "failed"; message: string };
/** The gateway said no for good (not a network problem): the merchant refunds by hand. */
export class RefundRejected extends Error {}
export type RefundRef = { pgOrderId: string; paymentId: string | null; refId: string; amountPaise: number };

const cfRefund = (j: { cf_refund_id?: string | number; refund_status?: string; status_description?: string }): GwRefund => ({
  id: j.cf_refund_id != null ? String(j.cf_refund_id) : null,
  status: j.refund_status === "SUCCESS" ? "processed" : j.refund_status === "CANCELLED" || j.refund_status === "REJECTED" ? "failed" : "pending",
  message: j.status_description ?? j.refund_status ?? "",
});
const ppRefund = (j: { refundId?: string; state?: string; errorCode?: string }): GwRefund => ({
  id: j.refundId ?? null, status: j.state === "COMPLETED" ? "processed" : j.state === "FAILED" ? "failed" : "pending", message: j.errorCode ?? j.state ?? "",
});
type PtBody = { resultInfo?: { resultStatus?: string; resultCode?: string; resultMsg?: string }; refundId?: string };
const ptSigned = (s: Secrets, body: Record<string, string>) => { const raw = JSON.stringify(body); return `{"body":${raw},"head":{"signature":${JSON.stringify(paytmSignature(raw, s.merchantKey))}}}`; };

/** Our refund (by refId) at the gateway, or null when the gateway has none. Network problems throw. */
export async function gatewayRefundLookup(orgId: string, g: GatewayKey, a: RefundRef): Promise<GwRefund | null> {
  const k = await load(orgId, g);
  if (!k) throw new Error("Gateway not configured");
  const mode = k.stored.mode;
  if (g === "cashfree") {
    const r = await call(g, mode, `/pg/orders/${encodeURIComponent(a.pgOrderId)}/refunds/${encodeURIComponent(a.refId)}`, { headers: cfHeaders(k.s) });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`Cashfree refund status ${r.status}`);
    return cfRefund(await r.json());
  }
  if (g === "phonepe") {
    const token = await phonepeToken(orgId, k.s, mode);
    const r = await call(g, mode, `${ppBase(mode)}/payments/v2/refund/${encodeURIComponent(a.refId)}/status`, { headers: { "content-type": "application/json", authorization: `O-Bearer ${token}` } });
    if (r.status === 404 || r.status === 400) return null;
    if (!r.ok) throw new Error(`PhonePe refund status ${r.status}`);
    return ppRefund(await r.json());
  }
  const r = await call(g, mode, "/v2/refund/status", { method: "POST", headers: { "content-type": "application/json" }, body: ptSigned(k.s, { mid: k.s.mid, orderId: a.pgOrderId, refId: a.refId }) });
  if (!r.ok) throw new Error(`Paytm refund status ${r.status}`);
  const b = ((await r.json()) as { body?: PtBody }).body;
  const st = b?.resultInfo?.resultStatus;
  if (st === "NO_RECORD_FOUND" || b?.resultInfo?.resultCode === "631") return null;
  return { id: b?.refundId ?? null, status: st === "TXN_SUCCESS" ? "processed" : st === "TXN_FAILURE" ? "failed" : "pending", message: b?.resultInfo?.resultMsg ?? st ?? "" };
}

/** Ask the gateway to refund the full payment. A definite "no" throws RefundRejected; network problems throw Error. */
export async function gatewayRefundCreate(orgId: string, g: GatewayKey, a: RefundRef): Promise<GwRefund> {
  const k = await load(orgId, g);
  if (!k) throw new RefundRejected("This payment gateway is not connected any more");
  const mode = k.stored.mode;
  if (g === "cashfree") {
    const r = await call(g, mode, `/pg/orders/${encodeURIComponent(a.pgOrderId)}/refunds`, {
      method: "POST", headers: cfHeaders(k.s), body: JSON.stringify({ refund_amount: Number(rupeeStr(a.amountPaise)), refund_id: a.refId, refund_note: "Order cancelled by seller" }),
    });
    if (r.status >= 500) throw new Error(`Cashfree refund ${r.status}`);
    const j = (await r.json().catch(() => ({}))) as { message?: string; cf_refund_id?: string | number; refund_status?: string; status_description?: string };
    if (!r.ok) throw new RefundRejected(j.message ?? `Cashfree refused the refund (${r.status})`);
    return cfRefund(j);
  }
  if (g === "phonepe") {
    const token = await phonepeToken(orgId, k.s, mode);
    const r = await call(g, mode, `${ppBase(mode)}/payments/v2/refund`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `O-Bearer ${token}` },
      body: JSON.stringify({ merchantRefundId: a.refId, originalMerchantOrderId: a.pgOrderId, amount: a.amountPaise }),
    });
    if (r.status >= 500) throw new Error(`PhonePe refund ${r.status}`);
    const j = (await r.json().catch(() => ({}))) as { message?: string; code?: string; refundId?: string; state?: string };
    if (!r.ok) throw new RefundRejected(j.message ?? j.code ?? `PhonePe refused the refund (${r.status})`);
    return ppRefund(j);
  }
  if (!a.paymentId) throw new RefundRejected("Paytm transaction id is missing");
  const r = await call(g, mode, "/refund/apply", {
    method: "POST", headers: { "content-type": "application/json" },
    body: ptSigned(k.s, { mid: k.s.mid, txnType: "REFUND", orderId: a.pgOrderId, txnId: a.paymentId, refId: a.refId, refundAmount: rupeeStr(a.amountPaise) }),
  });
  if (r.status >= 500) throw new Error(`Paytm refund ${r.status}`);
  if (!r.ok) throw new RefundRejected(`Paytm refused the refund (${r.status})`);
  const b = ((await r.json()) as { body?: PtBody }).body;
  const st = b?.resultInfo?.resultStatus;
  if (st === "TXN_FAILURE") throw new RefundRejected(b?.resultInfo?.resultMsg ?? "Paytm refused the refund");
  return { id: b?.refundId ?? null, status: st === "TXN_SUCCESS" ? "processed" : "pending", message: b?.resultInfo?.resultMsg ?? st ?? "" };
}
