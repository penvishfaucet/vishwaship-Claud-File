import "server-only";
import { createHash } from "node:crypto";
import { and, eq, gte, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { orgSetting, saveOrgSetting } from "@/server/couriers";
import { getDb, schema } from "@/server/db/client";
import { enqueue } from "@/server/jobs/runner";
import { decryptJson, encryptJson, maskSecret } from "@/server/security/crypto";
import { safeFetch } from "@/server/security/safe-fetch";
import { newId } from "@/server/util/ids";

/**
 * Store marketing: Meta Pixel + Conversions API, GA4 (gtag + Measurement Protocol), Google Ads conversion tag.
 * Settings live in org_settings "store_marketing"; tokens/secrets are encrypted and only shown as hints.
 * "Connected" is shown only after a live API check succeeded (Meta). Google gives no way to check a GA4 API secret,
 * so GA4 shows "Added" until then — never "Connected".
 * Purchases: online orders fire after payment; COD orders fire at the merchant's chosen milestone. Browser and server
 * events share one event id so platforms count the purchase once. Nothing is sent without the buyer's consent.
 */

export const GRAPH = () => `https://graph.facebook.com/${process.env.META_GRAPH_VERSION || "v23.0"}`;
const KEY = "store_marketing";
export const COD_MILESTONES = { placed: "When the order is placed", confirmed: "When the buyer confirms on WhatsApp", shipped: "When the courier picks it up", delivered: "When it is delivered (cash collected)" } as const;
export type CodMilestone = keyof typeof COD_MILESTONES;

/** connected = verified with the platform; added = accepted but the platform cannot confirm the secret; error = rejected. */
type Check = { ok: boolean; state: "connected" | "added" | "error"; message: string; at: string } | null;
export type Stored = {
  codMilestone: CodMilestone;
  meta?: { pixelId: string; tokenEnc: string | null; tokenHint: string | null; testEventCode: string; check: Check };
  ga4?: { measurementId: string; secretEnc: string | null; secretHint: string | null; check: Check };
  gads?: { conversionId: string; conversionLabel: string };
};

/** Test hook: replace the network in tests. */
let fetcher: (url: string, init: RequestInit & { timeoutMs?: number; allowedHosts?: string[] }) => Promise<Response> = safeFetch;
export const __setMarketingFetch = (f: typeof fetcher) => { fetcher = f; };

export async function marketing(orgId: string): Promise<Stored> {
  return { codMilestone: "confirmed", ...((await orgSetting<Stored>(orgId, KEY)) ?? {}) };
}

/** Public (browser) tag ids for the storefront. Never includes a secret. */
export async function publicTags(orgId: string) {
  const m = await marketing(orgId);
  return {
    metaPixelId: m.meta?.pixelId || null,
    ga4Id: m.ga4?.measurementId || null,
    gadsId: m.gads?.conversionId || null,
    gadsLabel: m.gads?.conversionLabel || null,
    codMilestone: m.codMilestone,
  };
}

/** Merchant-facing overview: hints and check results only. */
export async function marketingOverview(orgId: string) {
  const m = await marketing(orgId);
  return {
    codMilestone: m.codMilestone,
    meta: m.meta ? { pixelId: m.meta.pixelId, tokenHint: m.meta.tokenHint, testEventCode: m.meta.testEventCode, check: m.meta.check } : null,
    ga4: m.ga4 ? { measurementId: m.ga4.measurementId, secretHint: m.ga4.secretHint, check: m.ga4.check } : null,
    gads: m.gads ?? null,
  };
}

export const MarketingInput = z.object({
  codMilestone: z.enum(["placed", "confirmed", "shipped", "delivered"]),
  meta: z.object({ pixelId: z.string().trim().regex(/^$|^\d{10,20}$/, "Pixel ID is 10-20 digits"), token: z.string().trim().max(400).default(""), testEventCode: z.string().trim().max(30).default("") }),
  ga4: z.object({ measurementId: z.string().trim().toUpperCase().regex(/^$|^G-[A-Z0-9]{4,15}$/, "GA4 Measurement ID looks like G-XXXXXXX"), apiSecret: z.string().trim().max(100).default("") }),
  gads: z.object({ conversionId: z.string().trim().toUpperCase().regex(/^$|^AW-\d{6,15}$/, "Google Ads conversion ID looks like AW-123456789"), conversionLabel: z.string().trim().max(60).regex(/^[A-Za-z0-9_-]*$/, "Use the label from Google Ads").default("") }),
});

export async function saveMarketing(orgId: string, userId: string, input: z.infer<typeof MarketingInput>) {
  const old = await marketing(orgId);
  const next: Stored = { codMilestone: input.codMilestone };
  if (input.meta.pixelId) {
    const keep = old.meta?.pixelId === input.meta.pixelId || !!old.meta?.tokenEnc;
    const token = input.meta.token || (keep && old.meta?.tokenEnc ? decryptJson<string>(old.meta.tokenEnc) : "");
    next.meta = { pixelId: input.meta.pixelId, tokenEnc: token ? encryptJson(token) : null, tokenHint: token ? maskSecret(token) : null, testEventCode: input.meta.testEventCode, check: null };
  }
  if (input.ga4.measurementId) {
    const secret = input.ga4.apiSecret || (old.ga4?.secretEnc ? decryptJson<string>(old.ga4.secretEnc) : "");
    next.ga4 = { measurementId: input.ga4.measurementId, secretEnc: secret ? encryptJson(secret) : null, secretHint: secret ? maskSecret(secret) : null, check: null };
  }
  if (input.gads.conversionId) next.gads = { conversionId: input.gads.conversionId, conversionLabel: input.gads.conversionLabel };
  await saveOrgSetting(orgId, KEY, next, userId);
  return checkMarketing(orgId, userId);
}

/** Live checks: Meta reads the pixel with the token; GA4's debug endpoint validates the measurement id/event shape. */
export async function checkMarketing(orgId: string, userId?: string) {
  const m = await marketing(orgId);
  const now = new Date().toISOString();
  if (m.meta) {
    let check: Check;
    if (!m.meta.tokenEnc) check = { ok: false, state: "error", message: "Add a Conversions API access token to send purchases from the server", at: now };
    else {
      try {
        const r = await fetcher(`${GRAPH()}/${m.meta.pixelId}?fields=id,name&access_token=${encodeURIComponent(decryptJson<string>(m.meta.tokenEnc))}`, { timeoutMs: 12_000, allowedHosts: ["graph.facebook.com"] });
        const j = (await r.json().catch(() => ({}))) as { id?: string; name?: string; error?: { message?: string } };
        check = r.ok && j.id === m.meta.pixelId ? { ok: true, state: "connected", message: `Connected to pixel "${j.name ?? j.id}"`, at: now } : { ok: false, state: "error", message: `Meta did not accept the token for this pixel${j.error?.message ? `: ${j.error.message.slice(0, 160)}` : ""}`, at: now };
      } catch { check = { ok: false, state: "error", message: "Could not reach Meta. Try again in a minute.", at: now }; }
    }
    m.meta.check = check;
  }
  if (m.ga4) {
    let check: Check;
    if (!m.ga4.secretEnc) check = { ok: false, state: "error", message: "Add a Measurement Protocol API secret to send purchases from the server", at: now };
    else {
      try {
        const r = await fetcher(`https://www.google-analytics.com/debug/mp/collect?measurement_id=${encodeURIComponent(m.ga4.measurementId)}&api_secret=${encodeURIComponent(decryptJson<string>(m.ga4.secretEnc))}`, {
          method: "POST", timeoutMs: 12_000, allowedHosts: ["www.google-analytics.com"], headers: { "content-type": "application/json" },
          body: JSON.stringify({ client_id: "vishwaship.check", events: [{ name: "purchase", params: { currency: "INR", value: 1, transaction_id: "check" } }] }),
        });
        const j = (await r.json().catch(() => ({}))) as { validationMessages?: Array<{ description?: string }> };
        check = r.ok && !(j.validationMessages ?? []).length
          ? { ok: true, state: "added", message: "Added. Google does not let us confirm the API secret — check GA4 → Realtime after your next order.", at: now }
          : { ok: false, state: "error", message: `GA4 rejected the setup${j.validationMessages?.[0]?.description ? `: ${j.validationMessages[0].description}` : ""}`, at: now };
      } catch { check = { ok: false, state: "error", message: "Could not reach Google. Try again in a minute.", at: now }; }
    }
    m.ga4.check = check;
  }
  await saveOrgSetting(orgId, KEY, m, userId);
  return marketingOverview(orgId);
}

// ---------- server-side purchase events ----------
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "");
export const purchaseEventId = (storeOrderId: string) => `purchase_${storeOrderId}`;

type Attr = Record<string, string>;
type Order = typeof schema.storeOrders.$inferSelect;

/** Has this order reached the point where its purchase should be reported? */
export async function milestoneReached(o: Order, milestone: CodMilestone) {
  if (o.status !== "placed") return false;
  if (o.paymentMethod !== "cod") return o.paymentStatus === "paid";
  if (milestone === "placed") return true;
  if (!o.shippingOrderId) return false;
  const db = await getDb();
  const [so] = await db.select({ status: schema.orders.status }).from(schema.orders).where(eq(schema.orders.id, o.shippingOrderId));
  if (!so || so.status === "cancelled") return false;
  if (milestone === "confirmed") return !["cod_hold", "draft"].includes(so.status);
  const [sh] = await db.select({ status: schema.shipments.status }).from(schema.shipments)
    .where(and(eq(schema.shipments.orderId, o.shippingOrderId), notInArray(schema.shipments.bookingStatus, ["cancelled", "failed"])));
  if (!sh) return false;
  if (milestone === "delivered") return sh.status === "delivered";
  return !["booked", "pickup_pending", "cancelled"].includes(sh.status); // shipped = picked up or later
}

/** Create the per-platform conversion rows (once) for an order whose milestone is reached, and queue the sends. */
export async function queueConversions(storeOrderId: string) {
  const db = await getDb();
  const [o] = await db.select().from(schema.storeOrders).where(eq(schema.storeOrders.id, storeOrderId));
  if (!o) return 0;
  const m = await marketing(o.orgId);
  if (!(await milestoneReached(o, m.codMilestone))) return 0;
  const consent = (o.attribution as Attr).consent ?? "";
  const plats: Array<"meta" | "ga4"> = [];
  if (m.meta?.tokenEnc && m.meta.check?.ok) plats.push("meta");
  if (m.ga4?.secretEnc && m.ga4.check?.ok) plats.push("ga4");
  let n = 0;
  for (const platform of plats) {
    const allowed = platform === "meta" ? consent.includes("marketing") : consent.includes("analytics");
    const ins = await db.insert(schema.storeConversions).values({
      id: newId("scv"), storeOrderId: o.id, orgId: o.orgId, platform, eventId: purchaseEventId(o.id),
      status: allowed ? "pending" : "skipped", reason: allowed ? null : "Buyer did not consent",
    }).onConflictDoNothing().returning({ id: schema.storeConversions.id });
    if (ins.length && allowed) { await enqueue("store.conversion", { conversionId: ins[0].id }, { dedupeKey: `store.conversion:${ins[0].id}` }); n++; }
  }
  return n;
}

/** Send one conversion. Returns true when the platform accepted it. */
export async function sendConversion(conversionId: string): Promise<{ ok: boolean; retry: boolean; message: string }> {
  const db = await getDb();
  const [c] = await db.select().from(schema.storeConversions).where(eq(schema.storeConversions.id, conversionId));
  if (!c || c.status !== "pending") return { ok: true, retry: false, message: "nothing to do" };
  const [o] = await db.select().from(schema.storeOrders).where(eq(schema.storeOrders.id, c.storeOrderId));
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, o.storeId));
  const m = await marketing(o.orgId);
  const a = o.attribution as Attr;
  const b = o.buyer as { name: string; mobile: string; email: string; pincode: string; city: string; state: string };
  const lines = o.lines as Array<{ productId: string; variantId: string | null; title: string; qty: number; unitPaise: number }>;
  const value = o.totalPaise / 100;
  const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  let res: Response;
  try {
    if (c.platform === "meta") {
      if (!m.meta?.tokenEnc) return finish(c.id, "skipped", "Meta token removed");
      const user: Record<string, unknown> = {
        ph: [sha(`91${b.mobile.replace(/\D/g, "").slice(-10)}`)], zp: [sha(norm(b.pincode))], ct: [sha(norm(b.city))], st: [sha(norm(b.state))], country: [sha("in")],
        ...(b.email ? { em: [sha(b.email.trim().toLowerCase())] } : {}),
        ...(a.ip ? { client_ip_address: a.ip } : {}), ...(a.ua ? { client_user_agent: a.ua } : {}), ...(a.fbp ? { fbp: a.fbp } : {}), ...(a.fbc ? { fbc: a.fbc } : {}),
      };
      const body = {
        data: [{
          event_name: "Purchase", event_time: Math.floor((o.paidAt ?? o.placedAt ?? o.createdAt).getTime() / 1000), event_id: c.eventId, action_source: "website",
          event_source_url: `${appUrl}/s/${store.slug}/checkout/`, user_data: user,
          custom_data: { currency: "INR", value, order_id: o.number, num_items: lines.reduce((s, l) => s + l.qty, 0), content_type: "product", content_ids: lines.map((l) => l.variantId ?? l.productId), contents: lines.map((l) => ({ id: l.variantId ?? l.productId, quantity: l.qty, item_price: l.unitPaise / 100 })) },
        }],
        ...(m.meta.testEventCode ? { test_event_code: m.meta.testEventCode } : {}),
      };
      res = await fetcher(`${GRAPH()}/${m.meta.pixelId}/events?access_token=${encodeURIComponent(decryptJson<string>(m.meta.tokenEnc))}`, { method: "POST", timeoutMs: 15_000, allowedHosts: ["graph.facebook.com"], headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    } else {
      if (!m.ga4?.secretEnc) return finish(c.id, "skipped", "GA4 secret removed");
      const clientId = a.gaClientId || `${o.id}.${Math.floor(o.createdAt.getTime() / 1000)}`;
      const body = { client_id: clientId, events: [{ name: "purchase", params: { transaction_id: o.number, currency: "INR", value, shipping: o.shippingPaise / 100, coupon: o.couponCode ?? undefined, items: lines.map((l) => ({ item_id: l.variantId ?? l.productId, item_name: l.title, price: l.unitPaise / 100, quantity: l.qty })) } }] };
      res = await fetcher(`https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(m.ga4.measurementId)}&api_secret=${encodeURIComponent(decryptJson<string>(m.ga4.secretEnc))}`, { method: "POST", timeoutMs: 15_000, allowedHosts: ["www.google-analytics.com"], headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    }
  } catch (e) {
    await db.update(schema.storeConversions).set({ attempts: sql`${schema.storeConversions.attempts} + 1`, reason: (e as Error).message.slice(0, 200) }).where(eq(schema.storeConversions.id, c.id));
    return { ok: false, retry: true, message: "network" };
  }
  if (res.ok) return finish(c.id, "sent", null);
  const text = (await res.text().catch(() => "")).slice(0, 200);
  const retry = res.status >= 500 || res.status === 429;
  if (!retry) return finish(c.id, "failed", `${res.status} ${text}`);
  await db.update(schema.storeConversions).set({ attempts: sql`${schema.storeConversions.attempts} + 1`, reason: `${res.status} ${text}` }).where(eq(schema.storeConversions.id, c.id));
  return { ok: false, retry: true, message: `${res.status}` };
}

async function finish(id: string, status: "sent" | "skipped" | "failed", reason: string | null) {
  const db = await getDb();
  await db.update(schema.storeConversions).set({ status, reason, sentAt: status === "sent" ? new Date() : null, attempts: sql`${schema.storeConversions.attempts} + 1` }).where(eq(schema.storeConversions.id, id));
  return { ok: status === "sent", retry: false, message: status };
}

/** Sweep: placed orders of the last 30 days without conversion rows yet (COD orders wait for their milestone). */
export async function sweepConversions(now = new Date()) {
  const db = await getDb();
  const configured = await db.select({ orgId: schema.orgSettings.orgId }).from(schema.orgSettings).where(eq(schema.orgSettings.key, KEY));
  if (!configured.length) return 0;
  const orgs = configured.map((c) => c.orgId);
  const rows = await db.select({ id: schema.storeOrders.id }).from(schema.storeOrders)
    .leftJoin(schema.storeConversions, eq(schema.storeConversions.storeOrderId, schema.storeOrders.id))
    .where(and(inArray(schema.storeOrders.orgId, orgs), eq(schema.storeOrders.status, "placed"), gte(schema.storeOrders.createdAt, new Date(now.getTime() - 30 * 86400_000)), isNull(schema.storeConversions.id)))
    .limit(200);
  let n = 0;
  for (const r of rows) n += await queueConversions(r.id);
  return n;
}
