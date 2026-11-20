import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import { defaultTheme, readSettings } from "@/lib/store-themes";

const client = new PGlite();
const db = drizzle(client, { schema });
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getDb: async () => db, schema }));
vi.mock("@/server/auth/session", () => ({ readSession: async () => null }));

const mk = await import("./marketing");
const an = await import("./analytics");
const meta = await import("./meta-connect");

const A = "org_mk_a", B = "org_mk_b";
const TOKEN = "EAAB_secret_token_value_1234567890";
const calls: Array<{ url: string; body: string }> = [];
let metaEventsStatus = 200;
const fake = async (url: string, init: RequestInit = {}) => {
  calls.push({ url, body: String(init.body ?? "") });
  if (url.includes("/111222333444555?fields=id,name")) return url.includes(encodeURIComponent(TOKEN)) ? new Response(JSON.stringify({ id: "111222333444555", name: "Asha Pixel" })) : new Response(JSON.stringify({ error: { message: "Invalid OAuth access token" } }), { status: 400 });
  if (url.includes("/111222333444555/events")) return new Response(metaEventsStatus === 200 ? '{"events_received":1}' : "{}", { status: metaEventsStatus });
  if (url.includes("/debug/mp/collect")) return new Response(JSON.stringify({ validationMessages: [] }));
  if (url.includes("/mp/collect")) return new Response(null, { status: 204 });
  return new Response("{}", { status: 404 });
};
mk.__setMarketingFetch(fake as never);

let n = 0;
async function order(over: Partial<typeof schema.storeOrders.$inferInsert> = {}) {
  const id = `so_t${++n}`;
  await db.insert(schema.storeOrders).values({
    id, storeId: "st_mk", orgId: A, number: `MK${n}`, checkoutKey: `k${n}`, buyerToken: "t", status: "placed", paymentMethod: "razorpay", paymentStatus: "paid",
    buyer: { name: "B", mobile: "9876543210", email: "b@example.com", line1: "x", line2: "", pincode: "110001", city: "New Delhi", state: "Delhi" },
    lines: [{ productId: "p1", variantId: null, title: "Diya", qty: 2, unitPaise: 50000, weightGrams: 200 }],
    subtotalPaise: 100000, totalPaise: 100000, attribution: { consent: "analytics,marketing", fbp: "fb.1.1.1", ip: "1.2.3.4", ua: "UA" }, paidAt: new Date(), placedAt: new Date(), ...over,
  });
  return id;
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./migrations" });
  for (const o of [A, B]) await db.insert(schema.orgs).values({ id: o, name: o, businessName: o });
  await db.insert(schema.stores).values({ id: "st_mk", orgId: A, name: "Mk", slug: "mk-store", status: "live", draftTheme: defaultTheme(), publishedTheme: defaultTheme(), settings: readSettings({}) });
});

describe("marketing settings", () => {
  it("stores secrets encrypted, shows hints only, and says connected only after Meta accepts the token", async () => {
    let ov = await mk.saveMarketing(A, "u1", mk.MarketingInput.parse({ codMilestone: "confirmed", meta: { pixelId: "111222333444555", token: "wrong-token-123456" }, ga4: { measurementId: "g-abc1234", apiSecret: "ga_secret_abcdef" }, gads: { conversionId: "AW-123456789", conversionLabel: "AbC" } }));
    expect(ov.meta?.check?.state).toBe("error");
    ov = await mk.saveMarketing(A, "u1", mk.MarketingInput.parse({ codMilestone: "confirmed", meta: { pixelId: "111222333444555", token: TOKEN, testEventCode: "TEST1" }, ga4: { measurementId: "G-ABC1234" }, gads: { conversionId: "AW-123456789", conversionLabel: "AbC" } }));
    expect(ov.meta?.check).toMatchObject({ ok: true, state: "connected" });
    expect(ov.ga4?.check?.state).toBe("added"); // secret kept from the first save; Google can't confirm it
    const [row] = await db.select().from(schema.orgSettings).where(and(eq(schema.orgSettings.orgId, A), eq(schema.orgSettings.key, "store_marketing")));
    expect(JSON.stringify(row.value)).not.toContain(TOKEN);
    expect(JSON.stringify(row.value)).not.toContain("ga_secret_abcdef");
    expect(JSON.stringify(ov)).not.toContain(TOKEN);
    const tags = await mk.publicTags(A);
    expect(tags).toEqual({ metaPixelId: "111222333444555", ga4Id: "G-ABC1234", gadsId: "AW-123456789", gadsLabel: "AbC", codMilestone: "confirmed" });
    expect(await mk.publicTags(B)).toMatchObject({ metaPixelId: null });
  });
});

describe("purchase events", () => {
  it("online orders: one event per platform with the shared event id, hashed buyer data, sent once", async () => {
    const id = await order();
    expect(await mk.queueConversions(id)).toBe(2);
    expect(await mk.queueConversions(id)).toBe(0);
    const rows = await db.select().from(schema.storeConversions).where(eq(schema.storeConversions.storeOrderId, id));
    expect(rows.map((r) => r.eventId)).toEqual([mk.purchaseEventId(id), mk.purchaseEventId(id)]);
    calls.length = 0;
    for (const r of rows) expect((await mk.sendConversion(r.id)).ok).toBe(true);
    const metaCall = calls.find((c) => c.url.includes("/events"))!;
    const body = JSON.parse(metaCall.body);
    expect(body.data[0]).toMatchObject({ event_name: "Purchase", event_id: mk.purchaseEventId(id), action_source: "website" });
    expect(body.test_event_code).toBe("TEST1");
    expect(metaCall.body).not.toContain("9876543210");
    expect(metaCall.body).not.toContain("b@example.com");
    expect(body.data[0].user_data.fbp).toBe("fb.1.1.1");
    const ga = JSON.parse(calls.find((c) => c.url.includes("/mp/collect"))!.body);
    expect(ga.events[0]).toMatchObject({ name: "purchase", params: { transaction_id: "MK1", value: 1000 } });
    expect((await mk.sendConversion(rows[0].id)).message).toBe("nothing to do");
  });

  it("no consent → nothing is sent", async () => {
    const id = await order({ attribution: {} });
    expect(await mk.queueConversions(id)).toBe(0);
    const rows = await db.select().from(schema.storeConversions).where(eq(schema.storeConversions.storeOrderId, id));
    expect(rows.every((r) => r.status === "skipped")).toBe(true);
  });

  it("COD waits for the milestone (confirmed on WhatsApp)", async () => {
    await db.insert(schema.warehouses).values({ id: "wh_mk", orgId: A, label: "W", contactName: "A", mobile: "9999999999", line1: "x", pincode: "110001", city: "Delhi", state: "Delhi" });
    await db.insert(schema.orders).values({ id: "ord_mk", orgId: A, orderNumber: "MKX", source: "online_store", status: "cod_hold", mode: "B2C", paymentType: "cod", codAmountPaise: 100000, declaredValuePaise: 100000, consignee: {}, warehouseId: "wh_mk" });
    const id = await order({ paymentMethod: "cod", paymentStatus: "cod_pending", paidAt: null, shippingOrderId: "ord_mk" });
    expect(await mk.queueConversions(id)).toBe(0);
    expect(await db.select().from(schema.storeConversions).where(eq(schema.storeConversions.storeOrderId, id))).toHaveLength(0);
    await db.update(schema.orders).set({ status: "ready" }).where(eq(schema.orders.id, "ord_mk"));
    expect(await mk.sweepConversions()).toBe(2);
  });

  it("server errors retry, bad requests stop", async () => {
    const id = await order();
    await mk.queueConversions(id);
    const [m] = await db.select().from(schema.storeConversions).where(and(eq(schema.storeConversions.storeOrderId, id), eq(schema.storeConversions.platform, "meta")));
    metaEventsStatus = 503;
    expect(await mk.sendConversion(m.id)).toMatchObject({ ok: false, retry: true });
    metaEventsStatus = 400;
    expect(await mk.sendConversion(m.id)).toMatchObject({ ok: false, retry: false });
    const [after] = await db.select().from(schema.storeConversions).where(eq(schema.storeConversions.id, m.id));
    expect(after.status).toBe("failed");
    metaEventsStatus = 200;
  });
});

describe("analytics", () => {
  it("counts views always and unique visitors once per day", async () => {
    const day = new Date("2026-11-10T06:00:00Z");
    await an.recordVisit("st_mk", "visitorAAAA1", day);
    await an.recordVisit("st_mk", "visitorAAAA1", day);
    await an.recordVisit("st_mk", null, day);
    const [v] = await db.select().from(schema.storeVisitsDaily).where(eq(schema.storeVisitsDaily.day, "2026-11-10"));
    expect(v).toMatchObject({ views: 3, visitors: 1 });
  });

  it("imports a Google Ads CSV (with title lines), replaces the same days, and keeps platform vs matched apart", async () => {
    const csv = "Campaign report\n\"November 1, 2026 - November 30, 2026\"\nDay,Campaign,Cost,Impr.,Clicks,Conversions,Conv. value\n2026-11-10,Diwali,\"1,000.00\",20000,400,5,\"4,000.00\"\nTotal,,1000,20000,400,5,4000\n";
    expect(await an.importGoogleAdsCsv(A, csv)).toEqual({ saved: 1, skipped: 1 });
    await an.importGoogleAdsCsv(A, csv);
    const g = await db.select().from(schema.storeAdStats).where(eq(schema.storeAdStats.platform, "google"));
    expect(g).toHaveLength(1);
    await order({ createdAt: new Date("2026-11-10T08:00:00Z"), attribution: { gclid: "abc", utm_campaign: "diwali" }, totalPaise: 250000 });
    const a = await an.storeAnalytics(A, "2026-11-10", "2026-11-10");
    const google = a.platforms.find((p) => p.platform === "google")!;
    expect(google).toMatchObject({ spendPaise: 100000, platformPurchases: 5, platformValuePaise: 400000, matchedOrders: 1, matchedRevenuePaise: 250000 });
    expect(google.cpm).toBe(5000); // ₹50 per 1000 impressions
    expect(google.cpc).toBe(250); // ₹2.50
    expect(google.ctr).toBeCloseTo(0.02);
    expect(google.platformRoas).toBe(4);
    expect(google.matchedRoas).toBe(2.5);
    expect(google.costPerPurchase).toBe(100000);
    expect(google.campaigns[0].matchedOrders).toBe(1);
    expect(an.matchPlatform({ utm_source: "Instagram" })).toBe("meta");
    expect(an.matchPlatform({ fbclid: "x" })).toBe("meta");
    expect(an.matchPlatform({})).toBeNull();
  });
});

describe("Meta connect", () => {
  it("rejects a state made for another account or tampered", async () => {
    process.env.META_APP_ID = "app1"; process.env.META_APP_SECRET = "appsecret";
    const url = new URL(meta.metaAuthUrl(A)!);
    const state = url.searchParams.get("state")!;
    expect(url.searchParams.get("scope")).toContain("ads_read");
    expect(meta.checkState(state, A)).toBe(true);
    expect(meta.checkState(state, B)).toBe(false);
    expect(meta.checkState(state.replace(/.$/, (c) => (c === "a" ? "b" : "a")), A)).toBe(false);
  });

  it("connects, verifies the chosen ad account live, and syncs campaign days", async () => {
    meta.__setMetaFetch((async (url: string) => {
      if (url.includes("/oauth/access_token")) return new Response(JSON.stringify({ access_token: "LONG_TOKEN", expires_in: 5_000_000 }));
      if (url.includes("/me?fields")) return new Response(JSON.stringify({ id: "u1", name: "Asha" }));
      if (url.includes("/me/businesses")) return new Response(JSON.stringify({ data: [{ id: "b1", name: "Asha Biz" }] }));
      if (url.includes("/me/accounts")) return new Response(JSON.stringify({ data: [{ id: "pg1", name: "Asha Page", instagram_business_account: { id: "ig1", username: "asha" } }] }));
      if (url.includes("/me/adaccounts")) return new Response(JSON.stringify({ data: [{ id: "act_9", name: "Asha Ads", currency: "INR" }] }));
      if (url.includes("act_9/insights")) return new Response(JSON.stringify({ data: [{ campaign_id: "c1", campaign_name: "Diwali", date_start: "2026-11-10", spend: "500.50", impressions: "10000", clicks: "250", actions: [{ action_type: "omni_purchase", value: "3" }], action_values: [{ action_type: "omni_purchase", value: "3600" }] }] }));
      if (/\/(b1|pg1|ig1|act_9)\?fields/.test(url)) return new Response(JSON.stringify({ id: "ok" }));
      return new Response(JSON.stringify({ error: { message: "nope" } }), { status: 400 });
    }) as never);
    expect((await meta.completeMetaConnect(A, "u1", "code")).ok).toBe(true);
    const conn = await meta.metaConnection(A);
    expect(JSON.stringify(conn)).not.toContain("LONG_TOKEN");
    expect(conn?.pages[0].instagram?.name).toBe("asha");
    expect((await meta.syncMetaInsights(A)).ok).toBe(false); // nothing selected/verified yet
    expect((await meta.selectMetaAssets(A, "u1", { adAccountId: "act_other" })).ok).toBe(false);
    expect((await meta.selectMetaAssets(A, "u1", { businessId: "b1", pageId: "pg1", adAccountId: "act_9" })).ok).toBe(true);
    expect(Object.keys((await meta.metaConnection(A))!.verified).sort()).toEqual(["adAccount", "business", "instagram", "page"]);
    expect(await meta.orgsWithMetaAds()).toEqual([A]);
    expect((await meta.syncMetaInsights(A)).ok).toBe(true);
    const [row] = await db.select().from(schema.storeAdStats).where(eq(schema.storeAdStats.platform, "meta"));
    expect(row).toMatchObject({ day: "2026-11-10", spendPaise: 50050, impressions: 10000, clicks: 250, platformPurchases: 3, platformValuePaise: 360000, source: "api" });
  });
});
