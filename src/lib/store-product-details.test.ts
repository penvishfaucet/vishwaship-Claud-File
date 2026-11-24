import { describe, expect, it } from "vitest";
import { ProductAttributes, attrKey, facetsFor, readDetails } from "./store-product-details";
import { heroSlides } from "./store-themes";

describe("product attributes → shop filters", () => {
  it("only attributes with 2+ values across 2+ products become filters, most used first", () => {
    const p = (...a: Array<[string, string]>) => ({ attributes: a.map(([name, value]) => ({ name, value })) });
    const f = facetsFor([p(["Finish", "Chrome"], ["Material", "Brass"], ["Brand", "Penvish"]), p(["Finish", "Matt black"], ["Material", "Brass"], ["Brand", "Penvish"]), p(["Finish", "Chrome"], ["Size", "15 mm"])]);
    expect(f.map((x) => x.name)).toEqual(["Finish"]); // Material and Brand have one value only; Size is on one product
    expect(f[0]).toMatchObject({ key: "a_finish", values: [{ value: "Chrome", count: 2 }, { value: "Matt black", count: 1 }] });
    expect(attrKey("Pack size")).toBe("a_pack-size");
  });
  it("attribute names are unique and details fall back to empty", () => {
    expect(ProductAttributes.safeParse([{ name: "Finish", value: "A" }, { name: "finish", value: "B" }]).success).toBe(false);
    expect(readDetails({ specs: "bad" })).toEqual({ highlights: "", specs: [], usage: "", inBox: "", care: "", warranty: "" });
  });
  it("banner slides carry the phone image and alt text", () => {
    const [a, b] = heroSlides({ heading: "Hi", image: "sm_aaaaaaaa", image_mobile: "sm_bbbbbbbb", image_alt: "Taps", s2_heading: "Two", s2_image_mobile: "sm_cccccccc" }, "/s/x", "Store");
    expect(a).toMatchObject({ image: "sm_aaaaaaaa", imageMobile: "sm_bbbbbbbb", alt: "Taps" });
    expect(b).toMatchObject({ imageMobile: "sm_cccccccc", alt: "" });
  });
});
