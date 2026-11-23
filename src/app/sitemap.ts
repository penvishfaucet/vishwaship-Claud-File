import type { MetadataRoute } from "next";
import { PUBLIC_PAGES, siteUrl } from "@/lib/seo";

/** /sitemap.xml — the public pages on the main domain (APP_URL), read at request time. */
export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = siteUrl();
  const now = new Date();
  return PUBLIC_PAGES.map((p) => ({ url: `${base}${p.path}`, lastModified: now, changeFrequency: p.freq, priority: p.priority }));
}
