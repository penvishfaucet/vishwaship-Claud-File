import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getDb: async () => { throw new Error("no db in this test"); }, schema: {} }));
const { emptyRouteMessage, MSG, PublicRatesInput, serviceKey, sourceName } = await import("./public-rates");
const { boxTotals } = await import("@/components/site/RateCalcV3");

const O = "249402", D = "400001";
const ns = (message: string) => ({ status: "no_service" as const, category: "not_serviceable", message });

describe("public calculator: message when no rate comes back", () => {
  it("every service says the delivery PIN is not served → delivery message", () => {
    expect(emptyRouteMessage([ns(`Delhivery does not deliver to ${D}`), ns(`Delhivery B2B does not deliver to ${D}`)], O, D)).toEqual({ kind: "delivery", message: MSG.deliveryNotServiceable });
  });
  it("every service names only the pickup PIN → pickup message", () => {
    expect(emptyRouteMessage([ns(`No pickup from ${O}`)], O, D).kind).toBe("pickup");
  });
  it("route-level answers (both PINs, or no PIN) → route message", () => {
    expect(emptyRouteMessage([ns(`Courier partner has no courier from ${O} to ${D} for this shipment`), ns(`Delhivery does not deliver to ${D}`)], O, D)).toEqual({ kind: "route", message: MSG.routeNoService });
    expect(emptyRouteMessage([{ status: "no_service", category: "unsupported", message: "single box only" }], O, D).kind).toBe("route");
  });
  it("only timeouts → retry; some timeouts plus refusals → route with a retry hint", () => {
    expect(emptyRouteMessage([{ status: "failed", category: "timeout", message: "did not respond" }], O, D)).toEqual({ kind: "retry", message: MSG.retry });
    const mixed = emptyRouteMessage([ns(`Delhivery does not deliver to ${D}`), { status: "failed", category: "timeout" }], O, D);
    expect(mixed.kind).toBe("retry");
    expect(mixed.message).toContain(MSG.routeNoService);
  });
});

describe("public calculator input", () => {
  const ok = { originPincode: O, destinationPincode: D, paymentType: "prepaid", declaredValueRupees: 1000, packages: [{ count: 1, lengthCm: 10, breadthCm: 10, heightCm: 10, weightKg: 1 }] };
  it("rejects a malformed pincode with the exact customer text", () => {
    const r = PublicRatesInput.safeParse({ ...ok, originPincode: "04940" });
    expect(r.success).toBe(false);
    expect(r.error!.issues[0].message).toBe("Enter a valid 6-digit pincode.");
  });
  it("needs an invoice value (Delhivery B2B quotes need inv_amount > 0)", () => {
    expect(PublicRatesInput.safeParse({ ...ok, declaredValueRupees: 0 }).success).toBe(false);
    expect(PublicRatesInput.safeParse({ ...ok, declaredValueRupees: undefined }).success).toBe(false);
  });
  it("COD needs an amount; FOD needs a parcel over 15 kg", () => {
    expect(PublicRatesInput.safeParse({ ...ok, paymentType: "cod" }).success).toBe(false);
    expect(PublicRatesInput.safeParse({ ...ok, paymentType: "cod", codAmountRupees: 500 }).success).toBe(true);
    expect(PublicRatesInput.safeParse({ ...ok, paymentType: "fod" }).success).toBe(false);
    expect(PublicRatesInput.safeParse({ ...ok, paymentType: "fod", packages: [{ ...ok.packages[0], weightKg: 16 }] }).success).toBe(true);
  });
});

describe("service keys", () => {
  it("single-mode Delhivery accounts keep one key; partner networks get one per mode", () => {
    expect(serviceKey("delhivery_b2b", "B2B")).toBe("delhivery_b2b");
    expect(serviceKey("delhivery_b2b", "B2C")).toBe("delhivery_b2b");
    expect(serviceKey("delhivery_b2c", "B2C")).toBe("delhivery_b2c");
    expect(serviceKey("shipmozo", "B2B")).toBe("shipmozo_b2b");
    expect(serviceKey("shiporax", "B2C")).toBe("shipmozo_b2c");
  });
});

describe("customer-facing source names", () => {
  it("names Delhivery, never the aggregator", () => {
    expect(sourceName("delhivery_b2b", "B2B", null)).toBe("Delhivery B2B");
    expect(sourceName("shipmozo", "B2C", null)).toMatch(/^Partner network B2C/);
    expect(sourceName("shiporax", "B2C", { partnerCode: "VSX" })).toBe("Partner network B2C · VSX");
  });
});

describe("box totals", () => {
  it("chargeable = higher of actual and volumetric across boxes", () => {
    const t = boxTotals([{ count: "2", w: "3", l: "50", b: "40", h: "30" }, { count: "1", w: "1", l: "10", b: "10", h: "10" }]);
    expect(t.count).toBe(3);
    expect(t.actual).toBe(7);
    expect(t.vol).toBeCloseTo(24.2, 5);
    expect(t.chargeable).toBeCloseTo(24.2, 5);
  });
});
