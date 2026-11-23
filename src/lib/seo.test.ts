import { afterEach, describe, expect, it } from "vitest";
import { PRIVATE_PATHS, PUBLIC_PAGES, llmsTxt, pageMeta, siteUrl, structuredData } from "./seo";
import sitemap from "@/app/sitemap";
import robots from "@/app/robots";

describe("SEO", () => {
  const prev = process.env.APP_URL;
  afterEach(() => { process.env.APP_URL = prev; });

  it("uses APP_URL (main domain) everywhere, defaulting to vishwaship.com", () => {
    process.env.APP_URL = "https://vishwaship.com/";
    expect(siteUrl()).toBe("https://vishwaship.com");
    delete process.env.APP_URL;
    expect(siteUrl()).toBe("https://vishwaship.com");
  });

  it("sitemap lists every public page on the main domain, never private areas", () => {
    process.env.APP_URL = "https://vishwaship.com";
    const urls = sitemap().map((e) => e.url);
    expect(urls).toContain("https://vishwaship.com/");
    expect(urls).toContain("https://vishwaship.com/shipping-rate-calculator/");
    expect(urls).toHaveLength(PUBLIC_PAGES.length);
    for (const u of urls) for (const p of PRIVATE_PATHS) expect(u.includes(p)).toBe(false);
  });

  it("robots.txt points to the sitemap and closes accounts and APIs", () => {
    process.env.APP_URL = "https://vishwaship.com";
    const r = robots();
    expect(r.sitemap).toBe("https://vishwaship.com/sitemap.xml");
    const rule = Array.isArray(r.rules) ? r.rules[0] : r.rules;
    expect(rule.disallow).toEqual(expect.arrayContaining(["/admin/", "/portal/", "/api/"]));
  });

  it("page metadata has canonical, Open Graph and X tags with the share image", () => {
    const m = pageMeta("/track/", "Track", "Track it");
    expect(m.alternates?.canonical).toBe("/track/");
    expect(m.openGraph).toMatchObject({ url: "/track/", title: "Track", description: "Track it", siteName: "Vishwaship" });
    expect(JSON.stringify(m.openGraph)).toContain("/og-image.jpg");
    expect(m.twitter).toMatchObject({ card: "summary_large_image" });
  });

  it("llms.txt follows the llmstxt.org shape with absolute links", () => {
    process.env.APP_URL = "https://vishwaship.com";
    const t = llmsTxt();
    expect(t.startsWith("# Vishwaship\n\n> ")).toBe(true);
    expect(t).toContain("## Main pages");
    expect(t).toContain("(https://vishwaship.com/track/)");
    expect(t).toContain("(https://vishwaship.com/sitemap.xml)");
  });

  it("structured data names the organisation and the tracking search", () => {
    process.env.APP_URL = "https://vishwaship.com";
    const [org, site] = structuredData() as Array<Record<string, unknown>>;
    expect(org["@type"]).toBe("Organization");
    expect(JSON.stringify(site)).toContain("https://vishwaship.com/track/?awb={awb}");
  });
});
