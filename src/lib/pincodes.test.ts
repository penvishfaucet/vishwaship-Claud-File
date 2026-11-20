import { describe, expect, it } from "vitest";
import { guessPincode } from "./pincodes";

describe("offline PIN → state fallback", () => {
  it("gives a real state for every region, North East included", () => {
    const cases: Array<[string, string]> = [
      ["799002", "Tripura"], ["790001", "Arunachal Pradesh"], ["793001", "Meghalaya"], ["795001", "Manipur"], ["796001", "Mizoram"], ["797001", "Nagaland"],
      ["781001", "Assam"], ["737101", "Sikkim"], ["744101", "Andaman and Nicobar Islands"], ["403001", "Goa"], ["160017", "Chandigarh"],
      ["248001", "Uttarakhand"], ["263001", "Uttarakhand"], ["262001", "Uttar Pradesh"], ["226001", "Uttar Pradesh"],
      ["800001", "Bihar"], ["834001", "Jharkhand"], ["831001", "Jharkhand"], ["110001", "Delhi"], ["400001", "Maharashtra"],
    ];
    for (const [pin, state] of cases) expect(guessPincode(pin).state, pin).toBe(state);
  });
  it("never answers with a region that is not a state", () => {
    for (let p = 110; p <= 855; p++) {
      const s = guessPincode(`${p}001`).state;
      if (s) expect(s).not.toMatch(/North East|\//);
    }
  });
});
