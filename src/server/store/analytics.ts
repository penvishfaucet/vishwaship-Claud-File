import "server-only";
import { createHash } from "node:crypto";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { parseCsv } from "@/server/orders/bulk";
import { newId } from "@/server/util/ids";
import { StoreError } from "./catalog";
import { storeForOrg } from "./service";

/**
 * Store + ad analytics. Two kinds of "purchases" are kept apart on purpose:
 *  - platform-reported: what Meta / Google say their ads produced (their own attribution model)
 *  - matched: store orders we can tie to the platform ourselves (fbclid/gclid or utm_source on the order)
 */

export const istDay = (d: Date) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);

/** Page view beacon. Unique visitors only when the buyer allowed analytics (a random id, hashed per day). */
export async function recordVisit(storeId: string, vid: string | null, now = new Date()) {
  const db = await getDb();
  const day = istDay(now);
  let isNew = false;
  if (vid && /^[A-Za-z0-9_-]{8,64}$/.test(vid)) {
    const hash = createHash("sha256").update(`${vid}:${day}`).digest("hex").slice(0, 32);
    const ins = await db.insert(schema.storeVisitors).values({ storeId, day, visitorHash: hash }).onConflictDoNothing().returning({ d: schema.storeVisitors.day });
    isNew = ins.length > 0;
  }
  await db.insert(schema.storeVisitsDaily).values({ storeId, day, views: 1, visitors: isNew ? 1 : 0 })
    .onConflictDoUpdate({ target: [schema.storeVisitsDaily.storeId, schema.storeVisitsDaily.day], set: { views: sql`${schema.storeVisitsDaily.views} + 1`, visitors: sql`${schema.storeVisitsDaily.visitors} + ${isNew ? 1 : 0}` } });
}

const META_SOURCES = ["facebook", "fb", "instagram", "ig", "meta", "an", "messenger"];
export function matchPlatform(a: Record<string, string>): "meta" | "google" | null {
  const src = (a.utm_source ?? "").toLowerCase();
  if (a.fbclid || META_SOURCES.includes(src)) return "meta";
  if (a.gclid || src === "google" || src === "youtube") return "google";
  return null;
}

type Totals = { spendPaise: number; impressions: number; clicks: number; platformPurchases: number; platformValuePaise: number; matchedOrders: number; matchedRevenuePaise: number };
const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

export function adMetrics(t: Totals) {
  return {
    ...t,
    cpm: ratio(t.spendPaise * 1000, t.impressions), // paise per 1000 impressions
    cpc: ratio(t.spendPaise, t.clicks),
    ctr: ratio(t.clicks, t.impressions),
    platformRoas: ratio(t.platformValuePaise, t.spendPaise),
    matchedRoas: ratio(t.matchedRevenuePaise, t.spendPaise),
    costPerPurchase: t.spendPaise > 0 ? ratio(t.spendPaise, t.matchedOrders) : null,
    costPerPlatformPurchase: t.spendPaise > 0 ? ratio(t.spendPaise, t.platformPurchases) : null,
  };
}

export async function storeAnalytics(orgId: string, from: string, to: string) {
  const s = await storeForOrg(orgId);
  if (!s) throw new StoreError("Create your store first");
  const db = await getDb();
  const start = new Date(`${from}T00:00:00+05:30`), end = new Date(`${to}T23:59:59.999+05:30`);
  const visits = await db.select().from(schema.storeVisitsDaily).where(and(eq(schema.storeVisitsDaily.storeId, s.id), gte(schema.storeVisitsDaily.day, from), lte(schema.storeVisitsDaily.day, to))).orderBy(asc(schema.storeVisitsDaily.day));
  const orders = await db.select().from(schema.storeOrders).where(and(eq(schema.storeOrders.storeId, s.id), gte(schema.storeOrders.createdAt, start), lte(schema.storeOrders.createdAt, end)));
  const placed = orders.filter((o) => o.status === "placed");
  const ads = await db.select().from(schema.storeAdStats).where(and(eq(schema.storeAdStats.storeId, s.id), gte(schema.storeAdStats.day, from), lte(schema.storeAdStats.day, to)));

  const days: string[] = [];
  for (let d = new Date(`${from}T12:00:00Z`); istDay(d) <= to && days.length < 400; d = new Date(d.getTime() + 86400_000)) days.push(d.toISOString().slice(0, 10));

  const views = visits.reduce((n, v) => n + v.views, 0), visitors = visits.reduce((n, v) => n + v.visitors, 0);
  const revenue = placed.reduce((n, o) => n + o.totalPaise, 0);
  const productUnits = new Map<string, { title: string; units: number; revenuePaise: number }>();
  for (const o of placed) for (const l of o.lines as Array<{ productId: string; title: string; qty: number; unitPaise: number }>) {
    const p = productUnits.get(l.productId) ?? { title: l.title, units: 0, revenuePaise: 0 };
    p.units += l.qty; p.revenuePaise += l.qty * l.unitPaise; productUnits.set(l.productId, p);
  }

  const platforms = (["meta", "google"] as const).map((platform) => {
    const rows = ads.filter((a) => a.platform === platform);
    const matched = placed.filter((o) => matchPlatform(o.attribution as Record<string, string>) === platform);
    const totals: Totals = {
      spendPaise: rows.reduce((n, r) => n + r.spendPaise, 0), impressions: rows.reduce((n, r) => n + r.impressions, 0), clicks: rows.reduce((n, r) => n + r.clicks, 0),
      platformPurchases: rows.reduce((n, r) => n + r.platformPurchases, 0), platformValuePaise: rows.reduce((n, r) => n + r.platformValuePaise, 0),
      matchedOrders: matched.length, matchedRevenuePaise: matched.reduce((n, o) => n + o.totalPaise, 0),
    };
    const campaigns = new Map<string, Totals & { name: string }>();
    for (const r of rows) {
      const c = campaigns.get(r.campaignId) ?? { name: r.campaignName ?? (r.campaignId || "All campaigns"), spendPaise: 0, impressions: 0, clicks: 0, platformPurchases: 0, platformValuePaise: 0, matchedOrders: 0, matchedRevenuePaise: 0 };
      c.spendPaise += r.spendPaise; c.impressions += r.impressions; c.clicks += r.clicks; c.platformPurchases += r.platformPurchases; c.platformValuePaise += r.platformValuePaise;
      campaigns.set(r.campaignId, c);
    }
    for (const o of matched) {
      const name = (o.attribution as Record<string, string>).utm_campaign;
      const hit = name ? [...campaigns.values()].find((c) => c.name.toLowerCase() === name.toLowerCase()) : undefined;
      if (hit) { hit.matchedOrders++; hit.matchedRevenuePaise += o.totalPaise; }
    }
    return {
      platform, hasData: rows.length > 0, ...adMetrics(totals),
      campaigns: [...campaigns.values()].map((c) => ({ name: c.name, ...adMetrics(c) })).sort((a, b) => b.spendPaise - a.spendPaise).slice(0, 20),
      lastUpdated: rows.reduce<Date | null>((m, r) => (!m || r.updatedAt > m ? r.updatedAt : m), null),
      sources: [...new Set(rows.map((r) => r.source))],
    };
  });

  const daily = days.map((day) => {
    const v = visits.find((x) => x.day === day);
    const dayOrders = placed.filter((o) => istDay(o.createdAt) === day);
    return {
      day, views: v?.views ?? 0, visitors: v?.visitors ?? 0, orders: dayOrders.length, revenuePaise: dayOrders.reduce((n, o) => n + o.totalPaise, 0),
      spendPaise: ads.filter((a) => a.day === day).reduce((n, a) => n + a.spendPaise, 0),
    };
  });

  return {
    from, to,
    store: {
      views, visitors, orders: placed.length, revenuePaise: revenue, aovPaise: placed.length ? Math.round(revenue / placed.length) : 0,
      // visitors are counted only for buyers who allowed analytics, so the rate is shown only when it can be meaningful
      conversionRate: visitors >= placed.length && visitors >= 20 ? ratio(placed.length, visitors) : null,
      cod: placed.filter((o) => o.paymentMethod === "cod").length, online: placed.filter((o) => o.paymentMethod !== "cod").length,
      cancelled: orders.filter((o) => o.status === "cancelled").length, abandonedPayments: orders.filter((o) => o.status === "cancelled" && o.paymentStatus === "failed").length,
      topProducts: [...productUnits.values()].sort((a, b) => b.revenuePaise - a.revenuePaise).slice(0, 5),
    },
    platforms, daily,
  };
}

/**
 * Google Ads daily report CSV (Google Ads → Reports → download as CSV) with columns like
 * Day, Campaign, Cost, Impr., Clicks, Conversions, Conv. value. Re-uploading the same days replaces them.
 */
export async function importGoogleAdsCsv(orgId: string, text: string) {
  const s = await storeForOrg(orgId);
  if (!s) throw new StoreError("Create your store first");
  let rows = parseCsv(text);
  // Google's export puts a title and date-range line above the header: find the real header row
  const hi = rows.findIndex((r) => r.some((c) => /^(day|date)$/i.test(c.trim())));
  if (hi < 0) throw new StoreError("Could not find a Day column. Download the report with Day as a column.");
  const header = rows[hi].map((h) => h.trim().toLowerCase());
  rows = rows.slice(hi + 1);
  const col = (names: string[]) => header.findIndex((h) => names.includes(h));
  const iDay = col(["day", "date"]), iCamp = col(["campaign"]), iCost = col(["cost", "spend", "cost (inr)"]), iImp = col(["impr.", "impressions", "impr"]),
    iClk = col(["clicks"]), iConv = col(["conversions", "conv."]), iVal = col(["conv. value", "conversion value", "all conv. value", "conv value"]);
  if (iCost < 0) throw new StoreError("Could not find a Cost column");
  const num = (v: string | undefined) => Number(String(v ?? "").replace(/[₹,\s]|INR/gi, "")) || 0;
  const db = await getDb();
  let saved = 0, skipped = 0;
  for (const r of rows) {
    const day = parseDay(r[iDay] ?? "");
    if (!day) { skipped++; continue; }
    const campaign = iCamp >= 0 ? (r[iCamp] ?? "").trim().slice(0, 120) : "";
    if (/^total/i.test(campaign) || /^total/i.test(r[iDay] ?? "")) { skipped++; continue; }
    const v = {
      spendPaise: Math.round(num(r[iCost]) * 100), impressions: Math.round(num(r[iImp])), clicks: Math.round(num(r[iClk])),
      platformPurchases: Math.round(num(r[iConv])), platformValuePaise: Math.round(num(r[iVal]) * 100), campaignName: campaign || null, source: "csv", updatedAt: new Date(),
    };
    await db.insert(schema.storeAdStats).values({ id: newId("sas"), storeId: s.id, orgId, platform: "google", day, campaignId: campaign.toLowerCase(), ...v })
      .onConflictDoUpdate({ target: [schema.storeAdStats.storeId, schema.storeAdStats.platform, schema.storeAdStats.day, schema.storeAdStats.campaignId], set: v });
    saved++;
  }
  if (!saved) throw new StoreError("No rows with a valid day were found");
  return { saved, skipped };
}

function parseDay(raw: string): string | null {
  const s = raw.trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/); // dd/mm/yyyy (Indian accounts)
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) || !/[a-z]/i.test(s) ? null : istDay(new Date(d.getTime() + 6 * 3600_000));
}
