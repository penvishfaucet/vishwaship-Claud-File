import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const { priceQuote, ALL_ELIGIBLE_COMPONENT_RULES } = await import("@/server/pricing/engine");
const { delhiveryB2bAdapter, odaFlag, fodFlag } = await import("@/server/providers/delhivery-b2b");
type ProviderContext = import("@/server/providers/types").ProviderContext;

const markup = (bps: number) => ({ bps, source: "customer_override" as const, ruleId: "r", ruleVersion: 1 });
const base = { provider: "delhivery_b2b", carrierCode: "delhivery", carrierName: "Delhivery", serviceName: "B2B", mode: "B2B" as const, chargeableWeightGrams: 20000, taxInclusive: false, taxRateBps: 1800 };

describe("one margin rule on the whole carrier subtotal (owner example)", () => {
  const q = { ...base, components: [{ code: "freight" as const, label: "Base freight", amount: 100_000 }, { code: "oda" as const, label: "ODA charge", amount: 20_000 }] };
  it("₹1,000 + ₹200 ODA → ₹1,500 at 25%, ₹1,320 at 10%, ₹1,200 at an explicit 0%", () => {
    expect(priceQuote(q, markup(2500), { gstBps: 1800, componentRules: ALL_ELIGIBLE_COMPONENT_RULES }).sellingSubtotal).toBe(150_000);
    expect(priceQuote(q, markup(1000), { gstBps: 1800, componentRules: ALL_ELIGIBLE_COMPONENT_RULES }).sellingSubtotal).toBe(132_000);
    expect(priceQuote(q, markup(0), { gstBps: 1800, componentRules: ALL_ELIGIBLE_COMPONENT_RULES }).sellingSubtotal).toBe(120_000);
  });
  it("shows the ODA line, lines add up to the subtotal, GST once on top", () => {
    const p = priceQuote(q, markup(2500), { gstBps: 1800, componentRules: ALL_ELIGIBLE_COMPONENT_RULES });
    expect(p.lines.map((l) => l.code)).toEqual(["freight", "oda"]);
    expect(p.lines.reduce((t, l) => t + l.sellPreTax, 0)).toBe(p.sellingSubtotal);
    expect(p.gst).toBe(27_000);
    expect(p.total).toBe(177_000);
  });
  it("an unconfirmed surcharge travels with the priced quote", () => {
    expect(priceQuote({ ...q, pending: "ODA not confirmed" }, markup(2500), { gstBps: 1800 }).pending).toBe("ODA not confirmed");
  });
});

describe("Delhivery serviceability flags", () => {
  it("reads ODA and FOD flags in the shapes Delhivery uses", () => {
    expect(odaFlag({ data: [{ pin: 793001, oda: "Y" }] })).toBe(true);
    expect(odaFlag({ data: { is_oda: false } })).toBe(false);
    expect(odaFlag({ data: { serviceable: true } })).toBeNull();
    expect(fodFlag({ data: [{ fod: "N" }] })).toBe(false);
    expect(fodFlag({ data: [{ freight_on_delivery: true }] })).toBe(true);
  });
});

function ctxFor(routes: Record<string, unknown>, config: Record<string, unknown> = {}) {
  const hits: string[] = [];
  const ctx = {
    accountId: `pa_${Math.random()}`, mode: "live" as const, config, secrets: { username: "u", password: "p" },
    fetch: async (url: string) => {
      const path = new URL(url).pathname + new URL(url).search;
      hits.push(path);
      if (path.startsWith("/ums/login")) return new Response(JSON.stringify({ jwt: "t" }), { status: 200 });
      const key = Object.keys(routes).find((k) => path.startsWith(k));
      const body = key ? routes[key] : { error: "nope" };
      return new Response(JSON.stringify(body), { status: key ? 200 : 404 });
    },
  } as unknown as ProviderContext;
  return { ctx, hits };
}
const req = (pay: "prepaid" | "fod") => ({ mode: "B2B" as const, originPincode: "249402", destinationPincode: "793001", paymentType: pay, declaredValue: 500_000,
  packages: [{ count: 1, lengthMm: 300, breadthMm: 300, heightMm: 300, actualWeightGrams: 20_000 }] });

describe("Delhivery B2B quotes for FOD / ODA", () => {
  const estimateNoOda = { data: { price_breakup: { base_freight_charge: 1000, fuel_surcharge: 100 } } };
  const estimateWithOda = { data: { price_breakup: { base_freight_charge: 1000, oda_charge: 200 } } };
  it("ODA destination with the ODA amount confirmed → ODA line, bookable", async () => {
    const { ctx } = ctxFor({ "/pincode-service/": { data: [{ oda: "Y" }] }, "/freight/estimate": estimateWithOda, "/tat/": { tat: 4 } });
    const r = await delhiveryB2bAdapter.quote(ctx, req("fod"));
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value[0].components.find((c) => c.code === "oda")?.amount).toBe(20_000);
    expect(r.value[0].pending).toBeUndefined();
  });
  it("ODA destination but no ODA amount from Delhivery → pending, so it cannot be booked", async () => {
    const { ctx } = ctxFor({ "/pincode-service/": { data: [{ oda: "Y" }] }, "/freight/estimate": estimateNoOda, "/tat/": { tat: 4 } });
    const r = await delhiveryB2bAdapter.quote(ctx, req("fod"));
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value[0].pending).toMatch(/ODA/);
  });
  it("non-ODA destination → normal quote", async () => {
    const { ctx } = ctxFor({ "/pincode-service/": { data: [{ oda: "N" }] }, "/freight/estimate": estimateNoOda, "/tat/": { tat: 4 } });
    const r = await delhiveryB2bAdapter.quote(ctx, req("fod"));
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value[0].pending).toBeUndefined();
    expect(r.value[0].components.some((c) => c.code === "oda")).toBe(false);
  });
  it("FOD not offered on the route → no FOD rate", async () => {
    const { ctx } = ctxFor({ "/pincode-service/": { data: [{ fod: "N" }] }, "/freight/estimate": estimateNoOda });
    const r = await delhiveryB2bAdapter.quote(ctx, req("fod"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.category).toBe("not_serviceable");
  });
  it("contract rate card: ODA per-kg with minimum is added; missing ODA rate → pending", async () => {
    const rc = { rateSource: "rate_card", rateCard: { perKgPaise: 1000, minKg: 20, odaPerKgPaise: 300, odaMinPaise: 75_000 } };
    const a = ctxFor({ "/pincode-service/": { data: [{ oda: "Y" }] }, "/tat/": { tat: 4 } }, rc);
    const r = await delhiveryB2bAdapter.quote(a.ctx, req("prepaid"));
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value[0].components.find((c) => c.code === "oda")?.amount).toBe(75_000); // max(₹750 min, 20 kg × ₹3)
    const b = ctxFor({ "/pincode-service/": { data: [{ oda: "Y" }] }, "/tat/": { tat: 4 } }, { rateSource: "rate_card", rateCard: { perKgPaise: 1000 } });
    const r2 = await delhiveryB2bAdapter.quote(b.ctx, req("prepaid"));
    if (!r2.ok) throw new Error(r2.error.message);
    expect(r2.value[0].pending).toMatch(/rate card/);
  });
});

describe("Delhivery B2B LR sync", () => {
  it("stores the job id with a prefix; lookup returns the LR once Delhivery issues it", async () => {
    const { ctx, hits } = ctxFor({ "/manifest?job_id=12345678": { data: { status: "Complete", lrn: "323116432", waybills: ["24919710016063"] } } });
    const r = await delhiveryB2bAdapter.lookupBooking(ctx, { vishwashipOrderId: "o1", providerOrderRef: "job:12345678" });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value).toMatchObject({ state: "confirmed", lrNumber: "323116432", awb: "323116432", pieceIds: ["24919710016063"] });
    expect(hits.some((h) => h.startsWith("/manifest?job_id=12345678"))).toBe(true); // a numeric job id is not mistaken for an LR
  });
  it("job still processing → LR/AWB pending (no LR invented)", async () => {
    const { ctx } = ctxFor({ "/manifest?job_id=abc": { data: { status: "Processing" } } });
    const r = await delhiveryB2bAdapter.lookupBooking(ctx, { vishwashipOrderId: "o1", providerOrderRef: "job:abc" });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value).toMatchObject({ state: "pending_async", awb: null });
  });
  it("older rows: a bare number Delhivery does not know as a job is the LR saved after reconcile", async () => {
    const { ctx } = ctxFor({});
    const r = await delhiveryB2bAdapter.lookupBooking(ctx, { vishwashipOrderId: "o1", providerOrderRef: "323116432" });
    if (!r.ok) throw new Error(r.error.message);
    expect(r.value).toMatchObject({ state: "confirmed", lrNumber: "323116432" });
  });
});
