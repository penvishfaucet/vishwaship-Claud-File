import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { orgSetting, saveOrgSetting } from "@/server/couriers";
import { getDb, schema } from "@/server/db/client";
import { decryptJson, encryptJson, hmacSha256Hex, maskSecret, safeEqual } from "@/server/security/crypto";
import { safeFetch } from "@/server/security/safe-fetch";

/**
 * The MERCHANT's own Razorpay account for store checkout. Completely separate from Vishwaship's Razorpay
 * (wallet recharges, src/server/payments/razorpay.ts): store payments settle to the merchant, never to the wallet.
 * Keys are stored encrypted in org_settings ("store_razorpay"); the page only ever sees masked hints.
 * Checkout is offered only after a live API call with the keys succeeded ("verified").
 */
const KEY = "store_razorpay";
type Secrets = { keyId: string; keySecret: string; webhookSecret: string };
type Stored = { secretsEnc: string; hints: { keyId: string; keySecret: string; webhookSecret: string }; mode: "test" | "live"; verified: boolean; lastTestAt: string | null; lastTestMessage: string | null; webhookKey: string };

export type RzPayment = { id: string; order_id: string; amount: number; currency: string; status: string; method?: string };

const appUrl = () => (process.env.APP_URL ?? (process.env.NODE_ENV === "production" ? "https://vishwaship.in" : "http://localhost:3000")).replace(/\/$/, "");
const HOSTS = ["api.razorpay.com"];

/** Test hook: lets tests replace the network. */
let fetcher: (url: string, init: RequestInit & { timeoutMs?: number; allowedHosts?: string[] }) => Promise<Response> = safeFetch;
export const __setRazorpayFetch = (f: typeof fetcher) => { fetcher = f; };

export async function razorpayOverview(orgId: string) {
  const s = await orgSetting<Stored>(orgId, KEY);
  if (!s) return null;
  return { hints: s.hints, mode: s.mode, verified: s.verified, lastTestAt: s.lastTestAt, lastTestMessage: s.lastTestMessage, webhookUrl: `${appUrl()}/api/webhooks/store-razorpay/${s.webhookKey}/` };
}

async function secrets(orgId: string): Promise<(Secrets & { stored: Stored }) | null> {
  const s = await orgSetting<Stored>(orgId, KEY);
  if (!s) return null;
  return { ...decryptJson<Secrets>(s.secretsEnc), stored: s };
}

const auth = (s: Secrets) => `Basic ${Buffer.from(`${s.keyId}:${s.keySecret}`).toString("base64")}`;

/** Save keys (any blank secret keeps the stored one), then test them against the Razorpay API. */
export async function saveRazorpayKeys(orgId: string, userId: string, input: { keyId: string; keySecret: string; webhookSecret: string }) {
  const keyId = input.keyId.trim();
  if (!/^rzp_(test|live)_[A-Za-z0-9]{8,40}$/.test(keyId)) return { ok: false as const, message: "Key ID should look like rzp_test_… or rzp_live_…" };
  const old = await secrets(orgId);
  const next: Secrets = {
    keyId,
    keySecret: input.keySecret.trim() || (old?.keyId === keyId ? old.keySecret : ""),
    webhookSecret: input.webhookSecret.trim() || old?.webhookSecret || "",
  };
  if (next.keySecret.length < 10) return { ok: false as const, message: "Enter the Key Secret" };
  const stored: Stored = {
    secretsEnc: encryptJson(next),
    hints: { keyId: next.keyId, keySecret: maskSecret(next.keySecret), webhookSecret: next.webhookSecret ? maskSecret(next.webhookSecret) : "" },
    mode: keyId.startsWith("rzp_live_") ? "live" : "test",
    verified: false, lastTestAt: null, lastTestMessage: null,
    webhookKey: old?.stored.webhookKey ?? randomBytes(18).toString("base64url"),
  };
  await saveOrgSetting(orgId, KEY, stored, userId);
  return testRazorpay(orgId, userId);
}

export async function testRazorpay(orgId: string, userId?: string) {
  const s = await secrets(orgId);
  if (!s) return { ok: false as const, message: "Add your Razorpay keys first" };
  let ok = false, message = "";
  try {
    const r = await fetcher("https://api.razorpay.com/v1/orders?count=1", { headers: { authorization: auth(s) }, timeoutMs: 12_000, allowedHosts: HOSTS });
    ok = r.ok;
    message = r.ok ? `Connected (${s.stored.mode} mode)` : r.status === 401 ? "Razorpay rejected these keys. Check Key ID and Key Secret." : `Razorpay returned ${r.status}. Try again later.`;
  } catch { message = "Could not reach Razorpay. Try again in a minute."; }
  await saveOrgSetting(orgId, KEY, { ...s.stored, verified: ok, lastTestAt: new Date().toISOString(), lastTestMessage: message }, userId);
  return ok ? { ok: true as const, message } : { ok: false as const, message };
}

export async function removeRazorpay(orgId: string) {
  const db = await getDb();
  await db.delete(schema.orgSettings).where(and(eq(schema.orgSettings.orgId, orgId), eq(schema.orgSettings.key, KEY)));
}

/** Usable for checkout only when the last live test passed. */
export async function razorpayReady(orgId: string) {
  const s = await orgSetting<Stored>(orgId, KEY);
  return !!s?.verified;
}

export async function createMerchantOrder(orgId: string, a: { amountPaise: number; receipt: string; notes: Record<string, string> }) {
  const s = await secrets(orgId);
  if (!s || !s.stored.verified) throw new Error("Online payments are not set up for this store");
  const r = await fetcher("https://api.razorpay.com/v1/orders", {
    method: "POST", timeoutMs: 15_000, allowedHosts: HOSTS, headers: { authorization: auth(s), "content-type": "application/json" },
    body: JSON.stringify({ amount: a.amountPaise, currency: "INR", receipt: a.receipt, notes: a.notes }),
  });
  if (!r.ok) throw new Error(`Payment could not be started (${r.status})`);
  const j = (await r.json()) as { id: string };
  return { rzOrderId: j.id, keyId: s.keyId };
}

export async function verifyMerchantSignature(orgId: string, rzOrderId: string, paymentId: string, signature: string) {
  const s = await secrets(orgId);
  if (!s) return false;
  return safeEqual(hmacSha256Hex(s.keySecret, `${rzOrderId}|${paymentId}`), signature);
}

export async function verifyMerchantWebhook(orgId: string, rawBody: string, signature: string | null) {
  const s = await secrets(orgId);
  if (!s?.webhookSecret || !signature) return false;
  return safeEqual(hmacSha256Hex(s.webhookSecret, rawBody), signature);
}

export async function fetchMerchantPayment(orgId: string, paymentId: string): Promise<RzPayment> {
  const s = await secrets(orgId);
  if (!s) throw new Error("Razorpay not configured");
  const r = await fetcher(`https://api.razorpay.com/v1/payments/${encodeURIComponent(paymentId)}`, { headers: { authorization: auth(s) }, timeoutMs: 15_000, allowedHosts: HOSTS });
  if (!r.ok) throw new Error(`Razorpay payment lookup failed (${r.status})`);
  return (await r.json()) as RzPayment;
}

export async function merchantOrderPayments(orgId: string, rzOrderId: string): Promise<RzPayment[]> {
  const s = await secrets(orgId);
  if (!s) return [];
  const r = await fetcher(`https://api.razorpay.com/v1/orders/${encodeURIComponent(rzOrderId)}/payments`, { headers: { authorization: auth(s) }, timeoutMs: 15_000, allowedHosts: HOSTS });
  if (!r.ok) throw new Error(`Razorpay order lookup failed (${r.status})`);
  return ((await r.json()) as { items?: RzPayment[] }).items ?? [];
}

/** Webhook URL key → org. */
export async function orgByWebhookKey(key: string): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{16,40}$/.test(key)) return null;
  const db = await getDb();
  const [r] = await db.select({ orgId: schema.orgSettings.orgId }).from(schema.orgSettings)
    .where(and(eq(schema.orgSettings.key, KEY), sql`${schema.orgSettings.value}->>'webhookKey' = ${key}`));
  return r?.orgId ?? null;
}
