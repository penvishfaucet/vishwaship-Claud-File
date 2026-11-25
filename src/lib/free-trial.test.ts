import { describe, expect, it } from "vitest";
import { FREE_TRIAL_DEFAULTS, freeTrialWindow, inFreeTrial } from "./free-trial";

const cfg = { ...FREE_TRIAL_DEFAULTS, startsOn: "2026-11-26", days: 30 };

describe("free first month", () => {
  it("existing clients get 30 days from the launch date", () => {
    const w = freeTrialWindow(cfg, new Date("2026-01-01T00:00:00Z"))!;
    expect(w.from.toISOString()).toBe("2026-11-25T18:30:00.000Z");
    expect(inFreeTrial(cfg, new Date("2026-01-01"), new Date("2026-12-20T00:00:00Z"))).toBe(true);
    expect(inFreeTrial(cfg, new Date("2026-01-01"), new Date("2026-12-27T00:00:00Z"))).toBe(false);
  });
  it("new clients get 30 days from signup", () => {
    const signup = new Date("2027-02-10T10:00:00Z");
    expect(inFreeTrial(cfg, signup, new Date("2027-03-11T09:00:00Z"))).toBe(true);
    expect(inFreeTrial(cfg, signup, new Date("2027-03-13T00:00:00Z"))).toBe(false);
  });
  it("is off when disabled", () => {
    expect(inFreeTrial({ ...cfg, enabled: false }, new Date("2026-12-01"), new Date("2026-12-02"))).toBe(false);
  });
});
