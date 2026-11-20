import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { orgSetting, saveOrgSetting } from "@/server/couriers";
import { getDb, schema } from "@/server/db/client";
import { decryptJson, encryptJson, hmacSha256Hex, safeEqual } from "@/server/security/crypto";
import { safeFetch } from "@/server/security/safe-fetch";
import { newId, randomToken } from "@/server/util/ids";
import { GRAPH } from "./marketing";

/**
 * "Connect with Facebook" for a merchant: Meta Business, Facebook Page, Instagram account, ad account and pixel.
 * Needs Vishwaship's Meta app (META_APP_ID / META_APP_SECRET on the server, approved by Meta for the scopes below).
 * The user token is stored encrypted; each selected asset shows "Connected" only after a live read with that token.
 * Ad results (spend, impressions, clicks, Meta-reported purchases) are synced daily into store_ad_stats.
 */
const KEY = "store_meta_connect";
export const META_SCOPES = ["business_management", "pages_show_list", "instagram_basic", "ads_read"];

type Asset = { id: string; name: string };
type Stored = {
  tokenEnc: string; expiresAt: string | null; fbUser: Asset;
  businesses: Asset[]; pages: Array<Asset & { instagram?: Asset | null }>; adAccounts: Array<Asset & { currency?: string; status?: number }>;
  selected: { businessId?: string; pageId?: string; adAccountId?: string };
  verified: { business?: string; page?: string; instagram?: string; adAccount?: string }; // ISO time of last successful read
  lastSyncAt: string | null; lastSyncMessage: string | null;
};

let fetcher: (url: string, init?: RequestInit & { timeoutMs?: number; allowedHosts?: string[] }) => Promise<Response> = safeFetch;
export const __setMetaFetch = (f: typeof fetcher) => { fetcher = f; };
const HOSTS = ["graph.facebook.com"];
const appUrl = () => (process.env.APP_URL ?? (process.env.NODE_ENV === "production" ? "https://vishwaship.in" : "http://localhost:3000")).replace(/\/$/, "");
export const metaAppConfigured = () => !!(process.env.META_APP_ID && process.env.META_APP_SECRET);
const redirectUri = () => `${appUrl()}/api/portal/store/meta/callback/`;

async function graph<T>(path: string, token: string): Promise<T> {
  const sep = path.includes("?") ? "&" : "?";
  const r = await fetcher(`${GRAPH()}/${path}${sep}access_token=${encodeURIComponent(token)}`, { timeoutMs: 15_000, allowedHosts: HOSTS });
  const j = (await r.json().catch(() => ({}))) as T & { error?: { message?: string } };
  if (!r.ok) throw new Error(j.error?.message?.slice(0, 200) ?? `Meta returned ${r.status}`);
  return j;
}

// ---------- OAuth ----------
const stateSecret = () => process.env.APP_ENCRYPTION_KEY ?? "dev";
export function metaAuthUrl(orgId: string) {
  if (!metaAppConfigured()) return null;
  const payload = `${orgId}.${Date.now() + 10 * 60_000}.${randomToken(8)}`;
  const state = `${Buffer.from(payload).toString("base64url")}.${hmacSha256Hex(stateSecret(), payload)}`;
  const u = new URL(`https://www.facebook.com/${process.env.META_GRAPH_VERSION || "v23.0"}/dialog/oauth`);
  u.searchParams.set("client_id", process.env.META_APP_ID!);
  u.searchParams.set("redirect_uri", redirectUri());
  u.searchParams.set("state", state);
  u.searchParams.set("scope", META_SCOPES.join(","));
  u.searchParams.set("response_type", "code");
  return u.toString();
}

export function checkState(state: string, orgId: string) {
  const [b64, sig] = state.split(".");
  if (!b64 || !sig) return false;
  const payload = Buffer.from(b64, "base64url").toString();
  if (!safeEqual(hmacSha256Hex(stateSecret(), payload), sig)) return false;
  const [org, exp] = payload.split(".");
  return org === orgId && Number(exp) > Date.now();
}

/** Exchange the code, upgrade to a long-lived token, and read the merchant's assets. */
export async function completeMetaConnect(orgId: string, userId: string, code: string) {
  if (!metaAppConfigured()) return { ok: false as const, message: "Facebook connection is not switched on yet" };
  const q = (p: Record<string, string>) => new URLSearchParams(p).toString();
  const r1 = await fetcher(`${GRAPH()}/oauth/access_token?${q({ client_id: process.env.META_APP_ID!, client_secret: process.env.META_APP_SECRET!, redirect_uri: redirectUri(), code })}`, { timeoutMs: 15_000, allowedHosts: HOSTS });
  const t1 = (await r1.json().catch(() => ({}))) as { access_token?: string };
  if (!r1.ok || !t1.access_token) return { ok: false as const, message: "Facebook did not complete the login. Please try again." };
  const r2 = await fetcher(`${GRAPH()}/oauth/access_token?${q({ grant_type: "fb_exchange_token", client_id: process.env.META_APP_ID!, client_secret: process.env.META_APP_SECRET!, fb_exchange_token: t1.access_token })}`, { timeoutMs: 15_000, allowedHosts: HOSTS });
  const t2 = (await r2.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
  const token = t2.access_token ?? t1.access_token;
  try {
    const me = await graph<{ id: string; name: string }>("me?fields=id,name", token);
    const biz = await graph<{ data: Asset[] }>("me/businesses?fields=id,name&limit=50", token).catch(() => ({ data: [] as Asset[] }));
    const pages = await graph<{ data: Array<Asset & { instagram_business_account?: { id: string; username?: string } }> }>("me/accounts?fields=id,name,instagram_business_account{id,username}&limit=50", token).catch(() => ({ data: [] }));
    const ads = await graph<{ data: Array<Asset & { currency?: string; account_status?: number }> }>("me/adaccounts?fields=id,name,currency,account_status&limit=50", token).catch(() => ({ data: [] }));
    const old = await orgSetting<Stored>(orgId, KEY);
    const stored: Stored = {
      tokenEnc: encryptJson(token), expiresAt: t2.expires_in ? new Date(Date.now() + t2.expires_in * 1000).toISOString() : null, fbUser: me,
      businesses: biz.data.map((b) => ({ id: b.id, name: b.name })),
      pages: pages.data.map((p) => ({ id: p.id, name: p.name, instagram: p.instagram_business_account ? { id: p.instagram_business_account.id, name: p.instagram_business_account.username ?? p.instagram_business_account.id } : null })),
      adAccounts: ads.data.map((a) => ({ id: a.id, name: a.name, currency: a.currency, status: a.account_status })),
      selected: old?.selected ?? {}, verified: {}, lastSyncAt: old?.lastSyncAt ?? null, lastSyncMessage: old?.lastSyncMessage ?? null,
    };
    await saveOrgSetting(orgId, KEY, stored, userId);
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, message: `Facebook connection failed: ${(e as Error).message}` };
  }
}

export async function metaConnection(orgId: string) {
  const s = await orgSetting<Stored>(orgId, KEY);
  if (!s) return null;
  const { tokenEnc: _t, ...view } = s;
  void _t;
  return view;
}

/** Merchant picks which business/page/ad account to use; each is read live before it shows as connected. */
export async function selectMetaAssets(orgId: string, userId: string, sel: { businessId?: string; pageId?: string; adAccountId?: string }) {
  const s = await orgSetting<Stored>(orgId, KEY);
  if (!s) return { ok: false as const, message: "Connect Facebook first" };
  const token = decryptJson<string>(s.tokenEnc);
  const verified: Stored["verified"] = {};
  const errors: string[] = [];
  const now = new Date().toISOString();
  if (sel.businessId && !s.businesses.some((b) => b.id === sel.businessId)) return { ok: false as const, message: "Business not found in your Facebook account" };
  if (sel.pageId && !s.pages.some((p) => p.id === sel.pageId)) return { ok: false as const, message: "Page not found in your Facebook account" };
  if (sel.adAccountId && !s.adAccounts.some((a) => a.id === sel.adAccountId)) return { ok: false as const, message: "Ad account not found in your Facebook account" };
  const tryRead = async (label: keyof Stored["verified"], path: string) => {
    try { await graph(path, token); verified[label] = now; } catch (e) { errors.push(`${label}: ${(e as Error).message}`); }
  };
  if (sel.businessId) await tryRead("business", `${sel.businessId}?fields=id,name`);
  if (sel.pageId) {
    await tryRead("page", `${sel.pageId}?fields=id,name`);
    const ig = s.pages.find((p) => p.id === sel.pageId)?.instagram;
    if (ig) await tryRead("instagram", `${ig.id}?fields=id,username`);
  }
  if (sel.adAccountId) await tryRead("adAccount", `${sel.adAccountId}?fields=id,name,account_status`);
  await saveOrgSetting(orgId, KEY, { ...s, selected: sel, verified }, userId);
  return errors.length ? { ok: false as const, message: `Some items could not be read: ${errors.join("; ")}` } : { ok: true as const };
}

export async function disconnectMeta(orgId: string) {
  const db = await getDb();
  await db.delete(schema.orgSettings).where(and(eq(schema.orgSettings.orgId, orgId), eq(schema.orgSettings.key, KEY)));
}

// ---------- ads insights ----------
const istDay = (d: Date) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
const PURCHASE_ACTIONS = ["omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase"];
type Insight = { campaign_id?: string; campaign_name?: string; date_start: string; spend?: string; impressions?: string; clicks?: string; actions?: Array<{ action_type: string; value: string }>; action_values?: Array<{ action_type: string; value: string }> };

/** Pull the last `days` days of campaign results from the selected ad account into store_ad_stats. */
export async function syncMetaInsights(orgId: string, days = 30) {
  const s = await orgSetting<Stored>(orgId, KEY);
  if (!s?.selected.adAccountId || !s.verified.adAccount) return { ok: false as const, message: "No verified ad account" };
  const db = await getDb();
  const [store] = await db.select({ id: schema.stores.id }).from(schema.stores).where(eq(schema.stores.orgId, orgId));
  if (!store) return { ok: false as const, message: "No store" };
  const acct = s.adAccounts.find((a) => a.id === s.selected.adAccountId);
  const until = istDay(new Date()), since = istDay(new Date(Date.now() - (days - 1) * 86400_000));
  const token = decryptJson<string>(s.tokenEnc);
  const pick = (arr: Insight["actions"]) => { for (const t of PURCHASE_ACTIONS) { const h = arr?.find((x) => x.action_type === t); if (h) return Number(h.value) || 0; } return 0; };
  let path = `${s.selected.adAccountId}/insights?level=campaign&time_increment=1&limit=500&fields=campaign_id,campaign_name,spend,impressions,clicks,actions,action_values&time_range=${encodeURIComponent(JSON.stringify({ since, until }))}`;
  let rows = 0, message: string;
  try {
    for (let page = 0; page < 20 && path; page++) {
      const j = await graph<{ data: Insight[]; paging?: { next?: string } }>(path, token);
      for (const r of j.data) {
        const v = {
          spendPaise: Math.round(Number(r.spend ?? 0) * 100), impressions: Number(r.impressions ?? 0), clicks: Number(r.clicks ?? 0),
          platformPurchases: Math.round(pick(r.actions)), platformValuePaise: Math.round(pick(r.action_values) * 100), campaignName: r.campaign_name ?? null, source: "api", updatedAt: new Date(),
        };
        await db.insert(schema.storeAdStats).values({ id: newId("sas"), storeId: store.id, orgId, platform: "meta", day: r.date_start, campaignId: r.campaign_id ?? "", ...v })
          .onConflictDoUpdate({ target: [schema.storeAdStats.storeId, schema.storeAdStats.platform, schema.storeAdStats.day, schema.storeAdStats.campaignId], set: v });
        rows++;
      }
      path = j.paging?.next ? j.paging.next.replace(/^https:\/\/graph\.facebook\.com\/v[\d.]+\//, "").replace(/([?&])access_token=[^&]*&?/, "$1") : "";
    }
    message = `Synced ${rows} day/campaign rows${acct?.currency && acct.currency !== "INR" ? ` (account currency ${acct.currency}: amounts shown as recorded by Meta)` : ""}`;
  } catch (e) {
    message = `Sync failed: ${(e as Error).message}`;
  }
  await saveOrgSetting(orgId, KEY, { ...s, lastSyncAt: new Date().toISOString(), lastSyncMessage: message });
  return { ok: !message.startsWith("Sync failed"), message, rows };
}

/** Orgs with a verified Meta ad account (for the daily sync job). */
export async function orgsWithMetaAds() {
  const db = await getDb();
  const rows = await db.select({ orgId: schema.orgSettings.orgId }).from(schema.orgSettings)
    .where(and(eq(schema.orgSettings.key, KEY), sql`${schema.orgSettings.value}->'verified'->>'adAccount' is not null`));
  return rows.map((r) => r.orgId);
}
