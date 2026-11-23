import { afterEach, describe, expect, it } from "vitest";
import { mainDomainUrl, publicOrigin } from "./public-origin";

const req = (host: string, path = "/api/auth/google/start?next=%2Fportal%2F") =>
  new Request(`https://0.0.0.0:3000${path}`, { headers: { host } });

describe("mainDomainUrl", () => {
  const prev = process.env.APP_URL;
  afterEach(() => { process.env.APP_URL = prev; });

  it("sends a visitor on vishwaship.in to the same path on the main domain", () => {
    process.env.APP_URL = "https://vishwaship.com";
    expect(mainDomainUrl(req("vishwaship.in"))?.toString()).toBe("https://vishwaship.com/api/auth/google/start?next=%2Fportal%2F");
    expect(mainDomainUrl(req("www.vishwaship.in"))?.origin).toBe("https://vishwaship.com");
    expect(mainDomainUrl(req("www.vishwaship.com"))?.origin).toBe("https://vishwaship.com");
  });

  it("does nothing on the main domain, unknown hosts or without APP_URL", () => {
    process.env.APP_URL = "https://vishwaship.com/";
    expect(mainDomainUrl(req("vishwaship.com"))).toBeNull();
    expect(mainDomainUrl(req("0.0.0.0:3000"))).toBeNull();
    expect(mainDomainUrl(req("evil.example"))).toBeNull();
    delete process.env.APP_URL;
    expect(mainDomainUrl(req("vishwaship.in"))).toBeNull();
  });

  it("prefers the proxy's forwarded host", () => {
    process.env.APP_URL = "https://vishwaship.com";
    const r = new Request("https://0.0.0.0:3000/x", { headers: { host: "0.0.0.0:3000", "x-forwarded-host": "vishwaship.in" } });
    expect(mainDomainUrl(r)?.toString()).toBe("https://vishwaship.com/x");
    expect(publicOrigin(r)).toBe("https://vishwaship.com");
  });
});
