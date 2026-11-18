import { describe, expect, it } from "vitest";
import { DEFAULTS, accountHref, upgradeLinks } from "@/lib/site-content";

describe("confirmed account links", () => {
  it("defaults are the exact URLs supplied by the owner", () => {
    expect(DEFAULTS.links).toEqual({ customerLogin: "https://vishwaship.in/login/", signUp: "https://vishwaship.in/signup/", franchiseLogin: "https://vishwaship.in/admin/login/" });
  });
  it("renders vishwaship.in links as same-site paths (identical destination on vishwaship.in)", () => {
    expect(accountHref("https://vishwaship.in/login/", "/x/")).toBe("/login/");
    expect(accountHref("https://www.vishwaship.in/signup/", "/x/")).toBe("/signup/");
    expect(accountHref("https://vishwaship.in/admin/login/", "/x/")).toBe("/admin/login/");
  });
  it("adds the return path for login", () => {
    expect(accountHref("https://vishwaship.in/login/", "/x/", "/portal/")).toBe("/login/?next=%2Fportal%2F");
  });
  it("keeps other https links and rejects unsafe ones", () => {
    expect(accountHref("https://example.com/a", "/x/")).toBe("https://example.com/a");
    expect(accountHref("javascript:alert(1)", "/login/")).toBe("/login/");
  });
  it("replaces the old customer./admin. sub-domain links saved earlier", () => {
    expect(upgradeLinks({ customerLogin: "https://customer.vishwaship.com/login", signUp: "https://customer.vishwaship.com/register", franchiseLogin: "https://admin.vishwaship.com/" }))
      .toEqual(DEFAULTS.links);
  });
});
