import { describe, expect, it } from "vitest";
import { COD_TEMPLATE, COD_VARS, fillTemplate, numbered, roughDelivery } from "./cod-template";
import { codDisplay } from "./order-view";

describe("COD confirmation template", () => {
  it("uses every variable, in a fixed order for numbered providers", () => {
    for (const lang of ["en", "hi"] as const) {
      const n = numbered(COD_TEMPLATE[lang]);
      expect(n.order).toEqual([...COD_VARS]);
      expect(n.text).not.toMatch(/[a-z_]+\}\}/);
    }
  });
  it("fills the preview", () => {
    expect(fillTemplate("Hi {{buyer_name}}, pay {{cod_amount}}", { buyer_name: "Ravi", cod_amount: "₹500" })).toBe("Hi Ravi, pay ₹500");
  });
  it("estimates delivery: 3 days in the same state, 5 elsewhere, skipping Sundays", () => {
    const mon = new Date("2026-11-23T06:00:00Z"); // Monday IST
    expect(roughDelivery("Uttarakhand", "uttarakhand", mon).toISOString().slice(0, 10)).toBe("2026-11-26");
    expect(roughDelivery("Uttarakhand", "Tripura", mon).toISOString().slice(0, 10)).toBe("2026-11-28");
  });
});

describe("FOD orders that also collect COD get the confirmation", () => {
  const base = { included: true, enabled: true, confirmation: { status: "confirmed", cancellationStatus: null }, messageStatus: "read" };
  it("FOD + COD shows the buyer's answer", () => {
    expect(codDisplay({ ...base, paymentType: "fod", codPaise: 20_000 }).buyer).toBe("confirmed");
  });
  it("FOD without COD is not applicable", () => {
    expect(codDisplay({ ...base, paymentType: "fod", codPaise: 0 }).buyer).toBe("not_applicable");
  });
});
