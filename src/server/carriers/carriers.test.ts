import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import * as schema from "@/server/db/schema";

// Real Postgres (PGlite + project migrations) with a scripted Shipmozo API behind safeFetch.
const client = new PGlite();
const db = drizzle(client, { schema });
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getDb: async () => db, schema }));

type Call = { url: string; body: unknown };
let calls: Call[] = [];
let script: (url: string, body: unknown) => Promise<unknown> | unknown = () => ({ result: "1", data: {} });
vi.mock("@/server/security/safe-fetch", () => ({
  safeFetch: async (url: string, init: RequestInit & { allowedHosts?: string[] }) => {
    const host = new URL(url).hostname;
    if (init.allowedHosts?.length && !init.allowedHosts.some((h) => host === h || host.endsWith(`.${h}`))) throw new Error(`blocked host ${host}`);
    const body = typeof init.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ url, body });
    const out = await script(url, body);
    if (out instanceof Response) return out;
    return new Response(JSON.stringify(out), { status: 200, headers: { "content-type": "application/json" } });
  },
}));

const { ALL_ELIGIBLE_COMPONENT_RULES, pickMarkup, priceQuote } = await import("@/server/pricing/engine");
const { mapShipmozoStatus, parseRateRow, shipmozoAdapter } = await import("@/server/providers/shipmozo");
const { encryptJson } = await import("@/server/security/crypto");
const { getQuotes } = await import("@/server/quotes/service");
const { bookOrder } = await import("@/server/booking/service");
const { setMarkup } = await import("@/server/pricing/rules");
const { setupState, recordCapability, missingRequired } = await import("./verification");
const { validateBaseUrl, CARRIER_SPECS } = await import("./specs");
const { withLedger } = await import("@/server/ledger/db-store");
const { credit } = await import("@/server/ledger/wallet");

const ORG = "org_a", OTHER = "org_b", STAFF = "usr_staff";
const SM_B2C = "pa_sm_b2c", SM_B2B = "pa_sm_b2b", DEMO = "pa_demo";
const RATE_ROW = { courier_id: 12, name: "Delhivery Surface", before_tax_total_charges: 1000, gst: 180, total_charges: 1180, estimated_delivery: "4 days", pickups_automatically_scheduled: "YES" };
const req = (mode: "B2C" | "B2B" = "B2C") => ({ mode, originPincode: "122001", destinationPincode: "110001", paymentType: "prepaid" as const, codAmount: 0, declaredValue: 100000, packages: [{ count: 1, lengthMm: 220, breadthMm: 100, heightMm: 100, actualWeightGrams: 500 }] });
const shipmozoHappy = (url: string, body?: unknown) => {
  if (url.endsWith("/pincode-serviceability")) return { result: "1", data: { serviceable: true } };
  if (url.endsWith("/rate-calculator")) return { result: "1", data: [RATE_ROW] };
  if (url.endsWith("/create-warehouse")) return { result: "1", data: { warehouse_id: "9001" } };
  // live behaviour: Shipmozo returns its own order id; ours comes back as refrence_id
  if (url.endsWith("/push-order")) { const ref = String((body as { order_id?: string } | null)?.order_id ?? ""); return { result: "1", data: { order_id: `61041AP${ref}`, refrence_id: ref } }; }
  if (url.endsWith("/assign-courier")) return { result: "1", data: { courier: "Delhivery" } };
  if (url.includes("/get-order-detail/")) { const id = url.split("/").pop()!; return { result: "1", data: { order_id: id, awb_number: id === "61041APord1" ? "SMAWB123" : `SM${id}`, courier: "Delhivery" } }; }
  return { result: "1", data: {} };
};

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./migrations" });
  await db.insert(schema.orgs).values([{ id: ORG, name: "A", businessName: "A Traders" }, { id: OTHER, name: "B", businessName: "B Traders" }]);
  await db.insert(schema.wallets).values([{ id: "wal_a", orgId: ORG }, { id: "wal_b", orgId: OTHER }]);
  await withLedger((s) => credit(s, { walletId: "wal_a", amount: 10_000_00, kind: "adjustment_credit", idempotencyKey: "seed", refType: "staff", refId: STAFF, memo: "seed" }));
  const secrets = encryptJson({ live: { publicKey: "pk_test_value", privateKey: "sk_test_value" } });
  await db.insert(schema.providerAccounts).values([
    { id: SM_B2C, adapter: "shipmozo", category: "shipping", label: "Shipmozo B2C", mode: "live", status: "enabled", secretsEnc: secrets, configPublic: { service: "B2C", payments: { prepaid: true, cod: true } } },
    { id: SM_B2B, adapter: "shipmozo", category: "shipping", label: "Shipmozo B2B", mode: "live", status: "disabled", secretsEnc: secrets, configPublic: { service: "B2B", pilotOrgIds: [ORG] } },
    { id: DEMO, adapter: "demo", category: "shipping", label: "Demo", mode: "test", status: "enabled", configPublic: {} },
  ]);
  const verified = Object.fromEntries(["authenticate", "quote", "book", "label", "track"].map((c) => [c, { state: "live_verified" }]));
  await db.update(schema.providerAccounts).set({ capabilities: verified }).where(eq(schema.providerAccounts.id, SM_B2C));
  await db.insert(schema.warehouses).values({ id: "wh_a", orgId: ORG, label: "Main", contactName: "Ravi", mobile: "9876543210", mobileVerifiedAt: new Date(), line1: "Plot 1", pincode: "122001", city: "Gurgaon", state: "Haryana", code: "W1001" });
});
beforeEach(() => { calls = []; script = shipmozoHappy; });

describe("markup priority", () => {
  const base = { provider: "shipmozo", carrierCode: "delhivery", carrierName: "Delhivery", serviceName: "Surface", mode: "B2C" as const, components: [{ code: "freight" as const, label: "Freight", amount: 100_000 }], taxInclusive: false, taxRateBps: 1800, chargeableWeightGrams: 500 };
  const at = (rows: Parameters<typeof pickMarkup>[0], org: string | null) => priceQuote(base, pickMarkup(rows, "shipmozo", "B2C", org), { gstBps: 1800, componentRules: ALL_ELIGIBLE_COMPONENT_RULES });
  const row = (provider: string, orgId: string | null, bps: number, v = 1) => ({ id: `${provider}-${orgId}-${bps}`, provider, orgId, bps, version: v, effectiveFrom: new Date(Date.now() - 1000), clearedAt: null });

  it("₹1,000 provider rate → ₹1,250 at the initial 25% global default", () => {
    const p = at([], ORG);
    expect(p.sellingSubtotal).toBe(125_000);
    expect(p.markup.source).toBe("global");
    expect(p.total).toBe(147_500); // GST once on the Vishwaship price
  });
  it("a customer at 10% gets ₹1,100; an explicit 0% gets ₹1,000", () => {
    expect(at([row("*", ORG, 1000)], ORG).sellingSubtotal).toBe(110_000);
    expect(at([row("*", ORG, 0)], ORG).sellingSubtotal).toBe(100_000);
    expect(at([row("*", ORG, 0)], ORG).markup.source).toBe("customer_override");
  });
  it("customer → provider/service default → global, and public quotes never use a customer rule", () => {
    const rows = [row("*", null, 2500), row("shipmozo:B2C", null, 1500), row("*", ORG, 1000)];
    expect(at(rows, ORG).sellingSubtotal).toBe(110_000);
    expect(at(rows, OTHER).sellingSubtotal).toBe(115_000);
    expect(at(rows, null).sellingSubtotal).toBe(115_000);
    expect(pickMarkup(rows, "shipmozo", "B2B", OTHER).bps).toBe(2500); // B2B has no default of its own
  });
});

describe("Shipmozo mapping", () => {
  it("reads courier_id, pre-tax rate, ETA and the pickup flag", () => {
    const r = parseRateRow({ ...RATE_ROW, pickups_automatically_scheduled: "NO" }, { mode: "B2C", gstTreatment: "auto", actualGrams: 500 });
    if ("error" in r) throw new Error(r.error);
    expect(r.courierId).toBe("12");
    expect(r.quote.components).toEqual([{ code: "freight", label: "Freight & surcharges", amount: 100_000 }]);
    expect(r.quote.taxInclusive).toBe(false);
    expect(r.quote.etaDays).toBe(4);
    expect(r.quote.carrierCode).toBe("delhivery");
    expect(r.quote.providerQuoteRef).toBe("shipmozo_api:12:manual");
  });
  it("reads the live rate-calculator shape (id, before_tax_total_charges, gst_percentage, \"0.5 KG\")", () => {
    // Field names as returned by the live account on 2026-11-18 (amounts illustrative).
    const r = parseRateRow({ id: 402, name: "Bluedart Prime 0.5KG", estimated_delivery: "1 Days", overhead_charges: 0, shipping_charges: 34, before_tax_total_charges: 34, gst: 6.12, total_charges: 40.12, gst_percentage: 18, pickups_automatically_scheduled: "YES", minimum_chargeable_weight: "0.5 KG" }, { mode: "B2C", gstTreatment: "auto", actualGrams: 300 });
    if ("error" in r) throw new Error(r.error);
    expect(r.courierId).toBe("402");
    expect(r.quote).toMatchObject({ carrierCode: "blue-dart", etaDays: 1, chargeableWeightGrams: 500, taxRateBps: 1800, taxInclusive: false, providerQuoteRef: "shipmozo_api:402:auto" });
    expect(r.quote.components.reduce((t, c) => t + c.amount, 0)).toBe(3400);
    const split = parseRateRow({ id: 9, name: "Ekart", shipping_charges: 30, overhead_charges: 5, before_tax_total_charges: 35, gst: 6.3, total_charges: 41.3 }, { mode: "B2C", gstTreatment: "auto", actualGrams: 500 });
    expect("quote" in split && split.quote.components.map((c) => c.amount)).toEqual([3000, 500]);
  });
  it("derives pre-tax from total − GST, and refuses a rate whose GST basis is unknown", () => {
    const r = parseRateRow({ courier_id: 3, name: "Xpressbees", total_charges: 236, gst: 36 }, { mode: "B2C", gstTreatment: "auto", actualGrams: 500 });
    expect("quote" in r && r.quote.components[0].amount).toBe(20_000);
    expect("error" in parseRateRow({ courier_id: 3, name: "X", total_charges: 236 }, { mode: "B2C", gstTreatment: "auto", actualGrams: 500 })).toBe(true);
    const inc = parseRateRow({ courier_id: 3, name: "X", total_charges: 236 }, { mode: "B2C", gstTreatment: "inclusive", actualGrams: 500 });
    expect("quote" in inc && inc.quote.taxInclusive).toBe(true);
  });
  it("never treats a pending pickup as picked up; unknown text does not advance status", () => {
    expect(mapShipmozoStatus("Pickup Pending")).toBe("pickup_pending");
    expect(mapShipmozoStatus("Pickup Scheduled")).toBe("pickup_pending");
    expect(mapShipmozoStatus("Picked Up")).toBe("picked_up");
    expect(mapShipmozoStatus("In Transit")).toBe("in_transit");
    expect(mapShipmozoStatus("Out For Delivery")).toBe("out_for_delivery");
    expect(mapShipmozoStatus("Delivered")).toBe("delivered");
    expect(mapShipmozoStatus("RTO Delivered")).toBe("rto_delivered");
    expect(mapShipmozoStatus("Something new")).toBe("booked");
  });
  it("sends both keys as headers to the approved host only, without a trailing slash", async () => {
    const ctx = { accountId: "x", mode: "live" as const, config: { service: "B2C", baseUrl: { live: "https://shipping-api.com/app/api/v1" } }, secrets: { publicKey: "pk", privateKey: "sk" },
      fetch: async (url: string, init: RequestInit) => { calls.push({ url, body: init.headers }); return new Response(JSON.stringify({ result: "1", data: { Info: "ok" } })); } };
    await shipmozoAdapter.health(ctx as never);
    expect(calls[0].url).toBe("https://shipping-api.com/app/api/v1/info");
    expect(calls[0].body).toMatchObject({ "public-key": "pk", "private-key": "sk" });
    expect(validateBaseUrl(CARRIER_SPECS.shipmozo, "live", "https://evil.example.com/app/api/v1").ok).toBe(false);
    expect(validateBaseUrl(CARRIER_SPECS.shipmozo, "live", "http://shipping-api.com/app/api/v1").ok).toBe(false);
    expect(validateBaseUrl(CARRIER_SPECS.shipmozo, "live", "https://shipping-api.com/app/api/v1/")).toEqual({ ok: true, url: "https://shipping-api.com/app/api/v1" });
  });
});

describe("quotes across providers", () => {
  it("one provider timing out does not hide the other providers' quotes", { timeout: 20_000 }, async () => {
    script = (url) => (url.includes("shipping-api.com") ? new Promise(() => {}) : shipmozoHappy(url)); // Shipmozo never answers
    const r = await getQuotes(req(), ORG, { persist: false });
    expect(r.offers.some((o) => o.provider === "demo")).toBe(true);
    expect(r.offers.some((o) => o.provider === "shipmozo")).toBe(false);
    expect(r.errors.join(" ")).toMatch(/did not respond/);
    expect(r.errors.join(" ")).not.toMatch(/shipmozo/i); // customers see the partner code, never the aggregator
  });
  it("B2C and B2B are separate: the B2B pilot account quotes only for its pilot customer", async () => {
    const mine = await getQuotes(req("B2B"), ORG, { persist: false });
    const other = await getQuotes(req("B2B"), OTHER, { persist: false });
    expect(mine.offers.filter((o) => o.providerAccountId === SM_B2B).length).toBe(1);
    expect(mine.offers.find((o) => o.providerAccountId === SM_B2B)?.isPilot).toBe(true);
    expect(other.offers.some((o) => o.providerAccountId === SM_B2B)).toBe(false);
    expect((await getQuotes(req("B2C"), ORG, { persist: false })).offers.some((o) => o.providerAccountId === SM_B2B)).toBe(false);
  });
  it("an Active account that is not fully verified never quotes", async () => {
    await db.update(schema.providerAccounts).set({ capabilities: {} }).where(eq(schema.providerAccounts.id, SM_B2C));
    expect((await getQuotes(req(), ORG, { persist: false })).offers.some((o) => o.providerAccountId === SM_B2C)).toBe(false);
    await db.update(schema.providerAccounts).set({ capabilities: Object.fromEntries(["authenticate", "quote", "book", "label", "track"].map((c) => [c, { state: "live_verified" }])) }).where(eq(schema.providerAccounts.id, SM_B2C));
  });
  it("'Activate now' quotes once the keys pass authentication, never before", async () => {
    const quotes = async () => (await getQuotes(req(), OTHER, { persist: false })).offers.some((o) => o.providerAccountId === SM_B2C);
    const saved = (await db.select().from(schema.providerAccounts).where(eq(schema.providerAccounts.id, SM_B2C)))[0];
    await db.update(schema.providerAccounts).set({ capabilities: {}, configPublic: { ...(saved.configPublic as object), activatedEarly: { at: "now", by: STAFF } } }).where(eq(schema.providerAccounts.id, SM_B2C));
    expect(await quotes()).toBe(false);
    await db.update(schema.providerAccounts).set({ capabilities: { authenticate: { state: "live_verified" } } }).where(eq(schema.providerAccounts.id, SM_B2C));
    expect(await quotes()).toBe(true);
    await db.update(schema.providerAccounts).set({ capabilities: saved.capabilities, configPublic: saved.configPublic }).where(eq(schema.providerAccounts.id, SM_B2C));
  });
  it("paused accounts stop quoting", async () => {
    await db.update(schema.providerAccounts).set({ status: "paused" }).where(eq(schema.providerAccounts.id, SM_B2C));
    expect((await getQuotes(req(), ORG, { persist: false })).offers.some((o) => o.providerAccountId === SM_B2C)).toBe(false);
    await db.update(schema.providerAccounts).set({ status: "enabled" }).where(eq(schema.providerAccounts.id, SM_B2C));
  });
  it("prices the Shipmozo rate with the customer's markup (₹1,000 → ₹1,100 at 10%)", async () => {
    await setMarkup("*", ORG, 1000, STAFF);
    const r = await getQuotes(req(), ORG, { persist: false });
    const sm = r.offers.find((o) => o.providerAccountId === SM_B2C)!;
    expect(sm.costPreTax).toBe(100_000);
    expect(sm.sellingSubtotal).toBe(110_000);
    expect(sm.partnerCode).toBe("VISW001B2C"); // shows which provider account the rate came from
    await setMarkup("*", ORG, 2500, STAFF);
  });
});

async function newOrder(id: string) {
  await db.insert(schema.orders).values({ id, orgId: ORG, orderNumber: id, status: "ready", mode: "B2C", paymentType: "prepaid", declaredValuePaise: 100000, warehouseId: "wh_a",
    consignee: { name: "Asha", mobile: "9123456780", line1: "Sector 1", pincode: "110001", city: "Delhi", state: "Delhi" }, products: [{ name: "Shoes", qty: 1, unitPrice: 100000 }] });
  await db.insert(schema.packages).values({ id: `pk_${id}`, orderId: id, count: 1, lengthMm: 220, breadthMm: 100, heightMm: 100, actualWeightGrams: 500 });
  const q = await getQuotes(req(), ORG);
  return q.offers.find((o) => o.providerAccountId === SM_B2C)!.quoteId;
}
const debits = async (orderId: string) => (await db.select().from(schema.ledgerEntries).where(eq(schema.ledgerEntries.refType, "shipment"))).filter((e) => e.memo?.includes(orderId)).length;

describe("booking through Shipmozo", () => {
  it("books the exact service behind the quote: push-order → assign-courier (courier_id) → AWB, one charge", async () => {
    const quoteId = await newOrder("ord_1");
    const r = await bookOrder({ orgId: ORG, orderId: "ord_1", quoteId, actorUserId: "usr_c" });
    expect(r).toMatchObject({ ok: true, awb: "SMAWB123", state: "confirmed" });
    const push = calls.find((c) => c.url.endsWith("/push-order"))!.body as Record<string, unknown>;
    expect(push).toMatchObject({ order_id: "ord1", payment_type: "PREPAID", weight: 500, length: 22, warehouse_id: "9001", consignee_pin_code: 110001 });
    expect(calls.find((c) => c.url.endsWith("/assign-courier"))!.body).toEqual({ order_id: "61041APord1", courier_id: 12 }) // Shipmozo's own id, not ours;
    expect(calls.some((c) => c.url.endsWith("/schedule-pickup"))).toBe(false); // pickups_automatically_scheduled = YES
    const [sh] = await db.select().from(schema.shipments).where(eq(schema.shipments.orderId, "ord_1"));
    expect(sh).toMatchObject({ provider: "shipmozo", providerAccountId: SM_B2C, providerOrderRef: "61041APord1", awb: "SMAWB123", pickupStatus: "scheduled" });
    expect(await debits("ord_1")).toBe(1);
  });
  it("a repeated click never makes a second provider booking or wallet charge", async () => {
    const before = calls.length;
    const [q] = await db.select().from(schema.quotes).where(and(eq(schema.quotes.orgId, ORG), eq(schema.quotes.providerAccountId, SM_B2C)));
    const again = await bookOrder({ orgId: ORG, orderId: "ord_1", quoteId: q.id, actorUserId: "usr_c" });
    expect(again).toMatchObject({ ok: false, code: "already_booked" });
    expect(calls.length).toBe(before);
    expect(await debits("ord_1")).toBe(1);
    expect((await db.select().from(schema.shipments).where(eq(schema.shipments.orderId, "ord_1"))).length).toBe(1);
  });
  it("a timeout keeps the hold and reconciles by order reference instead of re-booking", async () => {
    const quoteId = await newOrder("ord_2");
    script = (url, body) => (url.endsWith("/push-order") ? Promise.reject(new Error("socket hang up")) : shipmozoHappy(url, body));
    const r = await bookOrder({ orgId: ORG, orderId: "ord_2", quoteId, actorUserId: "usr_c" });
    expect(r).toMatchObject({ ok: false, code: "ambiguous" });
    const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, "ord_2"));
    expect(o.status).toBe("needs_reconcile");
    const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.dedupeKey, `reconcile:ord_2:${quoteId}`));
    expect(job.queue).toBe("booking.reconcile");
    expect(await debits("ord_2")).toBe(0);
  });
  it("asks before charging when the live rate changed since the quote expired", async () => {
    const quoteId = await newOrder("ord_3");
    await db.update(schema.quotes).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(schema.quotes.id, quoteId));
    script = (url, body) => (url.endsWith("/rate-calculator") ? { result: "1", data: [{ ...RATE_ROW, before_tax_total_charges: 1100 }] } : shipmozoHappy(url, body));
    const r = await bookOrder({ orgId: ORG, orderId: "ord_3", quoteId, actorUserId: "usr_c" });
    expect(r).toMatchObject({ ok: false, code: "price_changed" });
    expect(calls.some((c) => c.url.endsWith("/push-order"))).toBe(false);
    if (r.ok || r.code !== "price_changed") return;
    expect(r.newTotal).toBeGreaterThan(r.oldTotal);
    const ok = await bookOrder({ orgId: ORG, orderId: "ord_3", quoteId: r.newQuoteId, actorUserId: "usr_c" });
    expect(ok).toMatchObject({ ok: true });
  });
  it("a paused account takes no new bookings", async () => {
    const quoteId = await newOrder("ord_4");
    await db.update(schema.providerAccounts).set({ status: "paused" }).where(eq(schema.providerAccounts.id, SM_B2C));
    expect(await bookOrder({ orgId: ORG, orderId: "ord_4", quoteId, actorUserId: "usr_c" })).toMatchObject({ ok: false, code: "unsupported" });
    await db.update(schema.providerAccounts).set({ status: "enabled" }).where(eq(schema.providerAccounts.id, SM_B2C));
  });
});

describe("verification states", () => {
  it("a health check alone is Connected; activation needs rates, booking, label and tracking", async () => {
    const id = "pa_v";
    await db.insert(schema.providerAccounts).values({ id, adapter: "shipmozo", category: "shipping", label: "V", mode: "live", status: "disabled", secretsEnc: encryptJson({ live: { publicKey: "a", privateKey: "b" } }), configPublic: { service: "B2C" } });
    const get = async () => (await db.select().from(schema.providerAccounts).where(eq(schema.providerAccounts.id, id)))[0];
    expect(setupState(await get())).toBe("not_tested");
    await recordCapability(id, "authenticate", true);
    expect(setupState(await get())).toBe("connected");
    expect(missingRequired(await get())).toEqual(["quote", "book", "label", "track"]);
    for (const c of ["quote", "book", "label", "track"] as const) await recordCapability(id, c, true);
    expect(setupState(await get())).toBe("ready");
    await recordCapability(id, "track", false, { message: "timeout" }); // a later failure does not erase a verified pass
    expect(setupState(await get())).toBe("ready");
  });
  it("providers without an adapter stay in Documentation Required", async () => {
    await db.insert(schema.providerAccounts).values({ id: "pa_bd", adapter: "bluedart", category: "shipping", label: "Blue Dart", mode: "test", status: "disabled", configPublic: { service: "B2C" } });
    const [a] = await db.select().from(schema.providerAccounts).where(eq(schema.providerAccounts.id, "pa_bd"));
    expect(setupState(a)).toBe("documentation_required");
  });
});

describe("automatic warehouse sync and pickup request", () => {
  it("next pickup slot: today before 2 pm IST, else tomorrow; Sunday moves to Monday", async () => {
    const { nextPickupDate } = await import("./automation");
    expect(nextPickupDate(new Date("2026-11-18T04:30:00Z"))).toBe("2026-11-18"); // 10:00 IST Wed
    expect(nextPickupDate(new Date("2026-11-18T09:30:00Z"))).toBe("2026-11-19"); // 15:00 IST Wed
    expect(nextPickupDate(new Date("2026-11-21T09:30:00Z"))).toBe("2026-11-23"); // 15:00 IST Sat → Mon
  });
  it("a new pickup address is registered with every courier the customer can book", async () => {
    const { syncWarehouseEverywhere } = await import("./automation");
    await db.insert(schema.warehouses).values({ id: "wh_new", orgId: ORG, label: "Second", contactName: "Ravi", mobile: "9876543210", line1: "Plot 2", pincode: "122002", city: "Gurgaon", state: "Haryana", code: "W1002" });
    const r = await syncWarehouseEverywhere("wh_new");
    expect(r.failed).toEqual([]);
    const rows = await db.select().from(schema.warehouseProviderSync).where(eq(schema.warehouseProviderSync.warehouseId, "wh_new"));
    expect(rows.map((x) => x.providerAccountId).sort()).toEqual([SM_B2B, SM_B2C].sort()); // active B2C + B2B pilot for this customer
    expect(rows.every((x) => x.status === "registered" && x.providerWarehouseRef === "9001")).toBe(true);
    expect(calls.filter((c) => c.url.endsWith("/create-warehouse")).length).toBe(2);
  });
  it("a booking whose courier needs a pickup request queues one automatically", async () => {
    const saved = (await db.select().from(schema.providerAccounts).where(eq(schema.providerAccounts.id, SM_B2C)))[0];
    await db.update(schema.providerAccounts).set({ configPublic: { ...(saved.configPublic as object), skipManualPickup: true } }).where(eq(schema.providerAccounts.id, SM_B2C));
    script = (url, body) => (url.endsWith("/rate-calculator") ? { result: "1", data: [{ ...RATE_ROW, pickups_automatically_scheduled: "NO" }] } : shipmozoHappy(url, body));
    const quoteId = await newOrder("ord_5");
    const r = await bookOrder({ orgId: ORG, orderId: "ord_5", quoteId, actorUserId: "usr_c" });
    expect(r).toMatchObject({ ok: true });
    const [sh] = await db.select().from(schema.shipments).where(eq(schema.shipments.orderId, "ord_5"));
    const [job] = await db.select().from(schema.jobs).where(eq(schema.jobs.dedupeKey, `pickup.auto:${sh.id}`));
    expect(job?.queue).toBe("pickup.auto");
    await db.update(schema.providerAccounts).set({ configPublic: saved.configPublic }).where(eq(schema.providerAccounts.id, SM_B2C));
  });
});
