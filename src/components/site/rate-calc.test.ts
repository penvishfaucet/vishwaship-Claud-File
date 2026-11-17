import { describe, expect, it } from "vitest";
import { autoService, totalActualGrams } from "./RateCalcV2";
import { completeMobile, mergePartners, DEFAULT_PARTNERS, safeHref } from "@/lib/site-content";

describe("automatic B2C/B2B selection (10 kg threshold)", () => {
  const T = 10_000;
  it("9.99 kg selects B2C", () => expect(autoService(totalActualGrams([{ count: "1", w: "9.99" }]), T)).toBe("B2C"));
  it("10 kg selects B2B", () => expect(autoService(totalActualGrams([{ count: "1", w: "10" }]), T)).toBe("B2B"));
  it("10.01 kg selects B2B", () => expect(autoService(totalActualGrams([{ count: "1", w: "10.01" }]), T)).toBe("B2B"));
  it("uses the total across cartons (4 × 2.5 kg = 10 kg → B2B)", () => expect(autoService(totalActualGrams([{ count: "4", w: "2.5" }]), T)).toBe("B2B"));
  it("adds carton types (3 × 1.1 + 2 × 3.3 = 9.9 kg → B2C)", () => expect(autoService(totalActualGrams([{ count: "3", w: "1.1" }, { count: "2", w: "3.3" }]), T)).toBe("B2C"));
  it("follows a changed threshold", () => expect(autoService(totalActualGrams([{ count: "1", w: "6" }]), 5_000)).toBe("B2B"));
});

describe("website content helpers", () => {
  it("keeps every original partner when stored records are partial (additive)", () => {
    const merged = mergePartners([{ ...DEFAULT_PARTNERS[0], visible: false }, { id: "new-courier", name: "New", logoUrl: "/x.png", link: "", visible: true }]);
    for (const p of DEFAULT_PARTNERS) expect(merged.some((m) => m.id === p.id)).toBe(true);
    expect(merged.find((m) => m.id === DEFAULT_PARTNERS[0].id)?.visible).toBe(false);
    expect(merged.some((m) => m.id === "new-courier")).toBe(true);
  });
  it("only complete 10-digit numbers get contact buttons", () => {
    expect(completeMobile("8630982873")).toBe("8630982873");
    expect(completeMobile("+91 89295 90769")).toBe("8929590769");
    expect(completeMobile("786855")).toBeNull();
    expect(completeMobile("")).toBeNull();
  });
  it("rejects unsafe links", () => {
    expect(safeHref("javascript:alert(1)", "/login/")).toBe("/login/");
    expect(safeHref("//evil.example", "/login/")).toBe("/login/");
    expect(safeHref("https://customer.vishwaship.com/login", "/login/")).toBe("https://customer.vishwaship.com/login");
  });
});
