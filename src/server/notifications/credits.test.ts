import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { CREDIT_PRICE_DEFAULTS, quoteAmount } from "./credits";

describe("notification credit pricing", () => {
  it("₹1 buys 4 credits at ₹0.25 incl. GST", () => {
    const q = quoteAmount(1, CREDIT_PRICE_DEFAULTS, 1800);
    expect(q.credits).toBe(4);
    expect(q.totalPaise).toBe(100);
    expect(q.basePaise + q.gstPaise).toBe(100);
  });
  it("₹100 buys 400 credits; GST is inside the ₹100", () => {
    const q = quoteAmount(100, CREDIT_PRICE_DEFAULTS, 1800);
    expect(q.credits).toBe(400);
    expect(q.totalPaise).toBe(10_000);
    expect(q.basePaise).toBe(8475);
    expect(q.gstPaise).toBe(1525);
  });
  it("GST on top when the price excludes it", () => {
    const q = quoteAmount(100, { ...CREDIT_PRICE_DEFAULTS, gstInclusive: false }, 1800);
    expect(q.credits).toBe(400);
    expect(q.totalPaise).toBe(11_800);
  });
  it("never charges for a part credit", () => {
    expect(quoteAmount(10.1, CREDIT_PRICE_DEFAULTS, 1800).totalPaise).toBe(1000);
  });
});
