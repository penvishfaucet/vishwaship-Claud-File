import { describe, expect, it } from "vitest";
import { type MarkupSettings, type ProviderQuote, priceQuote, resolveMarkup } from "./engine";

const settings: MarkupSettings = {
  global: { bps: 2500, ruleId: "g1", version: 1 },
  overrides: [
    { orgId: "orgA", bps: 2000, ruleId: "oA", version: 1, effectiveFrom: new Date("2026-01-01") },
    { orgId: "orgB", bps: 1000, ruleId: "oB", version: 1, effectiveFrom: new Date("2026-01-01") },
    { orgId: "orgC", bps: 500, ruleId: "oC", version: 1, effectiveFrom: new Date("2026-01-01"), clearedAt: new Date("2026-06-01") },
  ],
};

const q100: ProviderQuote = {
  provider: "shipmozo", carrierCode: "delhivery", carrierName: "Delhivery", serviceName: "Surface",
  mode: "B2C", components: [{ code: "freight", label: "Freight", amount: 10_000 }],
  taxInclusive: false, taxRateBps: 1800, chargeableWeightGrams: 500,
};

const price = (org: string | null) =>
  priceQuote(q100, resolveMarkup(settings, org), { gstBps: 1800 });

describe("Shipmozo markup acceptance (spec section 5)", () => {
  it("falls back to the 25% global default", () => {
    expect(price("orgZ").sellingSubtotal).toBe(12_500);
    expect(price("orgZ").markup.source).toBe("global");
  });
  it("applies independent 20% and 10% customer overrides", () => {
    expect(price("orgA").sellingSubtotal).toBe(12_000);
    expect(price("orgB").sellingSubtotal).toBe(11_000);
  });
  it("restores the global default after an override is cleared", () => {
    expect(price("orgC").sellingSubtotal).toBe(12_500);
  });
  it("uses the global default for unauthenticated quotes", () => {
    expect(price(null).sellingSubtotal).toBe(12_500);
  });
  it("applies GST once on the selling subtotal", () => {
    const p = price("orgZ");
    expect(p.gst).toBe(2_250);
    expect(p.total).toBe(14_750);
  });
});

describe("component rules", () => {
  it("does not mark up pass-through fees and strips inclusive tax first", () => {
    const q: ProviderQuote = {
      ...q100,
      taxInclusive: true,
      components: [
        { code: "freight", label: "Freight", amount: 11_800 }, // ₹100 + 18%
        { code: "cod_fee", label: "COD fee", amount: 5_900 },  // ₹50 + 18%
      ],
    };
    const p = priceQuote(q, resolveMarkup(settings, null), { gstBps: 1800 });
    expect(p.eligibleCostPreTax).toBe(10_000);
    expect(p.passThroughPreTax).toBe(5_000);
    expect(p.sellingSubtotal).toBe(12_500 + 5_000);
    expect(p.lines.reduce((s, l) => s + l.sellPreTax, 0)).toBe(p.sellingSubtotal);
  });
  it("keeps line allocations summing exactly with awkward amounts", () => {
    const q: ProviderQuote = {
      ...q100,
      components: [
        { code: "freight", label: "Freight", amount: 3_333 },
        { code: "fuel", label: "Fuel", amount: 3_333 },
        { code: "docket", label: "Docket", amount: 3_334 },
      ],
    };
    const p = priceQuote(q, { bps: 2500, source: "global", ruleId: "g", ruleVersion: 1 }, { gstBps: 1800 });
    expect(p.lines.reduce((s, l) => s + l.sellPreTax, 0)).toBe(12_500);
  });
});
