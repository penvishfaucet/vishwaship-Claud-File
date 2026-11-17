import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getDb: vi.fn(), schema: {} }));
vi.mock("@/server/couriers", () => ({ courierPrefs: vi.fn() }));
vi.mock("@/server/quotes/service", () => ({ getQuotes: vi.fn() }));
const { choose } = await import("./auto-assign");

const offer = (carrierCode: string, total: number) => ({ carrierCode, carrierName: carrierCode, total }) as never;
const rule = (id: string, priority: number, conditions: object, couriers: string[], active = true) => ({ id, name: id, priority, conditions, couriers, active }) as never;
const facts = { mode: "B2C", payment: "cod", warehouseId: "w1", pincode: "400001", grams: 800 };

describe("auto-assign", () => {
  const offers = [offer("delhivery", 9000), offer("xpressbees", 8000), offer("dtdc", 9500)];
  it("uses the highest-priority matching rule", () => {
    const r = choose(offers, [rule("cod-mumbai", 1, { payment: "cod", pinPrefixes: ["400"] }, ["dtdc"]), rule("all", 5, {}, ["delhivery"])], [], facts);
    expect(r?.offer.carrierCode).toBe("dtdc");
    expect(r?.reason).toContain("cod-mumbai");
  });
  it("skips a rule courier that is not serviceable and says so", () => {
    const r = choose(offers, [rule("r", 1, {}, ["blue-dart", "delhivery"])], [], facts);
    expect(r?.offer.carrierCode).toBe("delhivery");
    expect(r?.reason).toContain("skipped blue-dart");
  });
  it("ignores non-matching and inactive rules, then falls back to preferences", () => {
    const r = choose(offers, [rule("b2b", 1, { mode: "B2B" }, ["dtdc"]), rule("off", 2, {}, ["dtdc"], false)], ["delhivery"], facts);
    expect(r?.offer.carrierCode).toBe("delhivery");
    expect(r?.reason).toContain("preference");
  });
  it("falls back to the cheapest courier", () => {
    const r = choose(offers, [rule("heavy", 1, { minGrams: 5000 }, ["dtdc"])], [], facts);
    expect(r?.offer.carrierCode).toBe("xpressbees");
  });
});
