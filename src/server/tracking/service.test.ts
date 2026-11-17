import { describe, expect, it } from "vitest";
import { isProgress } from "./service";

describe("isProgress (stale scans never roll status back)", () => {
  it("moves forward", () => {
    expect(isProgress("in_transit", "out_for_delivery")).toBe(true);
    expect(isProgress("out_for_delivery", "delivered")).toBe(true);
  });
  it("ignores older scans", () => {
    expect(isProgress("out_for_delivery", "in_transit")).toBe(false);
    expect(isProgress("delivered", "out_for_delivery")).toBe(false);
  });
  it("allows NDR and re-attempts", () => {
    expect(isProgress("out_for_delivery", "ndr")).toBe(true);
    expect(isProgress("ndr", "out_for_delivery")).toBe(true);
  });
  it("never leaves terminal states", () => {
    expect(isProgress("cancelled", "in_transit")).toBe(false);
    expect(isProgress("rto_delivered", "delivered")).toBe(false);
  });
});
