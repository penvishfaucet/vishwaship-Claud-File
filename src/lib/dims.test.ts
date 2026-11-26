import { describe, expect, it } from "vitest";
import { convertDim, fromCm, toCm } from "./dims";

describe("box size units", () => {
  it("converts inches and feet to cm", () => {
    expect(toCm("10", "in")).toBe(25.4);
    expect(toCm("2", "ft")).toBe(61);
    expect(toCm("1.5", "ft")).toBe(45.7);
    expect(toCm("30", "cm")).toBe(30);
    expect(toCm("", "in")).toBe(0);
    expect(toCm("abc", "ft")).toBe(0);
  });
  it("volumetric weight is worked out from the cm values", () => {
    const [l, b, h] = [toCm("12", "in"), toCm("12", "in"), toCm("12", "in")];
    expect(Math.round(((l * b * h) / 5000) * 100) / 100).toBe(5.67); // 30.5³ / 5000
  });
  it("switching unit keeps the box the same size", () => {
    expect(convertDim("50", "cm", "in")).toBe("19.69");
    expect(convertDim("2", "ft", "cm")).toBe("61");
    expect(convertDim("", "cm", "ft")).toBe("");
    expect(fromCm(30.48, "ft")).toBe(1);
  });
});
