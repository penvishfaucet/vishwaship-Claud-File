import { describe, expect, it } from "vitest";
import { addMargin, cardWithMargin } from "./franchise-rates";

describe("franchise rate list margin", () => {
  it("adds 10% to every line including COD, scales GST, keeps totals consistent", () => {
    const o = addMargin({
      lines: [{ code: "freight", label: "Freight", sellPreTax: 10000 }, { code: "cod", label: "COD charge", sellPreTax: 4000 }],
      sellingSubtotal: 14000, gst: 2520, total: 16520, payer: { sender: 16520, receiver: 0 },
    }, 1000);
    expect(o.lines.map((l) => l.sellPreTax)).toEqual([11000, 4400]);
    expect(o.sellingSubtotal).toBe(15400);
    expect(o.gst).toBe(2772);
    expect(o.total).toBe(18172);
    expect(o.payer).toEqual({ sender: 18172, receiver: 0 });
  });

  it("splits FOD payer in proportion", () => {
    const o = addMargin({ lines: [{ code: "f", label: "Freight", sellPreTax: 10000 }], sellingSubtotal: 10000, gst: 1800, total: 11800, payer: { sender: 0, receiver: 11800 } }, 1000);
    expect(o.payer).toEqual({ sender: 0, receiver: 12980 });
  });

  it("rounds rate-card amounts to whole rupees", () => {
    expect(cardWithMargin(3900, 1000)).toBe(4300);
    expect(cardWithMargin(5600, 1000)).toBe(6200);
  });
});
