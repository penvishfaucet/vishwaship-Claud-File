import { describe, expect, it } from "vitest";
import { DELHIVERY_B2B_COMPONENT_RULES, type ProviderQuote, priceQuote } from "./engine";
import { modeAllowed, payerSplit } from "@/server/payment-modes";
import { b2bCharges, b2cCharges } from "@/server/providers/delhivery-common";

const q = (extra: ProviderQuote["components"] = []): ProviderQuote => ({
  provider: "delhivery_b2b", carrierCode: "delhivery", carrierName: "Delhivery", serviceName: "B2B", mode: "B2B",
  components: [{ code: "freight", label: "Base freight", amount: 100_000 }, ...extra], taxInclusive: false, taxRateBps: 1800, chargeableWeightGrams: 20_000,
});
const rule = (bps: number) => ({ bps, source: "global" as const, ruleId: "r", ruleVersion: 1 });
const price = (bps: number, extra: ProviderQuote["components"] = []) => priceQuote(q(extra), rule(bps), { gstBps: 1800, componentRules: DELHIVERY_B2B_COMPONENT_RULES });

describe("Delhivery B2B freight markup", () => {
  it("₹1,000 base freight → ₹1,250 at the default 25%", () => {
    const p = price(2500);
    expect(p.lines.find((l) => l.code === "freight")?.sellPreTax).toBe(125_000);
    expect(p.sellingSubtotal).toBe(125_000);
    expect(p.gst).toBe(22_500);
    expect(p.total).toBe(147_500);
  });
  it("₹1,000 → ₹1,300 after Admin changes the markup to 30%", () => {
    expect(price(3000).sellingSubtotal).toBe(130_000);
  });
  it("marks up only the base freight; other charges pass through and GST is charged once", () => {
    const p = price(2500, [{ code: "fuel", label: "Fuel", amount: 10_000 }, { code: "docket", label: "Docket", amount: 5_000 }, { code: "cod_fee", label: "COD", amount: 3_000 }]);
    expect(p.sellingSubtotal).toBe(125_000 + 18_000);
    expect(p.gst).toBe(Math.round(143_000 * 0.18));
  });
});

describe("FOD payer split", () => {
  it("carrier_freight: receiver pays Delhivery freight + GST, sender pays only the margin + GST", () => {
    const p = price(2500);
    const s = payerSplit(p, "fod", "carrier_freight", 1800);
    expect(s.receiver).toBe(118_000);
    expect(s.sender).toBe(29_500);
    expect(s.sender + s.receiver).toBe(p.total);
  });
  it("vishwaship_rate: receiver pays everything, sender nothing", () => {
    const s = payerSplit(price(2500), "fod", "vishwaship_rate", 1800);
    expect(s).toMatchObject({ sender: 0, receiver: 147_500 });
  });
  it("prepaid / COD: sender pays the freight", () => {
    expect(payerSplit(price(2500), "cod", "carrier_freight", 1800)).toMatchObject({ sender: 147_500, receiver: 0 });
  });
  it("FOD cannot be booked until activated and enabled", () => {
    const base = { prepaid: true, cod: true, fod: true, fodBasis: "carrier_freight" as const };
    expect(modeAllowed({ ...base, fodStatus: "pending_activation" }, "fod").ok).toBe(false);
    expect(modeAllowed({ ...base, fod: false, fodStatus: "active" }, "fod").ok).toBe(false);
    expect(modeAllowed({ ...base, fodStatus: "active" }, "fod").ok).toBe(true);
    expect(modeAllowed({ ...base, cod: false, fodStatus: "active" }, "cod").ok).toBe(false);
  });
});

describe("Delhivery response parsing", () => {
  it("reads a B2B freight breakup and ignores request echoes and taxes", () => {
    const r = b2bCharges({ success: true, data: { price_breakup: { base_freight_charge: 1000, fuel_surcharge: 100, green_tax: 20, rov_charge: 50, gst: 210, total: 1380, cod_amount: 5000 }, charged_wt: 25 } });
    expect(r?.components.find((c) => c.code === "freight")?.amount).toBe(100_000);
    expect(r?.components.reduce((t, c) => t + c.amount, 0)).toBe(117_000);
    expect(r?.chargeableGrams).toBe(25_000);
  });
  it("never returns a ₹0 quote when no freight is present", () => {
    expect(b2bCharges({ data: { gst: 0, total: 0 } })).toBeNull();
    expect(b2cCharges([{ total_amount: 0 }])).toBeNull();
  });
  it("reads B2C kinko charges", () => {
    const c = b2cCharges([{ charge_DL: 45, charge_COD: 30, charge_FS: 5, gross_amount: 80, total_amount: 94.4, tax_data: { igst: 14.4 } }]);
    expect(c?.find((x) => x.code === "freight")?.amount).toBe(4_500);
    expect(c?.find((x) => x.code === "cod_fee")?.amount).toBe(3_000);
  });
});
