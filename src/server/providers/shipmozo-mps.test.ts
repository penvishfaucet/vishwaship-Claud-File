import { describe, expect, it } from "vitest";
import { shipmozoB2cTakesB2b, shipmozoBooksBoxes } from "./shipmozo-rules";

const box = (count: number, grams = 5000) => ({ packages: [{ count, lengthMm: 400, breadthMm: 300, heightMm: 300, actualWeightGrams: grams }] });

describe("Shipmozo multi-carton (Admin → Courier Integrations → Shipmozo B2B → 2 or more cartons)", () => {
  it("one carton is always bookable", () => {
    expect(shipmozoBooksBoxes(box(1), {})).toBe(true);
  });
  it("2+ cartons only once the switch is on", () => {
    expect(shipmozoBooksBoxes(box(2), {})).toBe(false);
    expect(shipmozoBooksBoxes(box(2), { mpsBookingVerified: true })).toBe(true);
  });
  it("the B2C account never takes 2+ cartons (its switch is never saved on)", () => {
    expect(shipmozoB2cTakesB2b(box(2), { service: "B2C" })).toBe(false);
  });
});
