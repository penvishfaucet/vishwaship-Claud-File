import type { MetadataRoute } from "next";
import { PRIVATE_PATHS, siteUrl } from "@/lib/seo";

/** /robots.txt — public pages open to search engines and AI crawlers; accounts, consoles and APIs closed. */
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  const base = siteUrl();
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: PRIVATE_PATHS }],
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
