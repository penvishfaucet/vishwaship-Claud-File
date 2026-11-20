import { loadStorefront } from "@/server/store/public";
import { canonicalBase } from "../_sf";

export const dynamic = "force-dynamic";

/** Per-store sitemap. Only live (published) stores have one; drafts and the demo store return 404. */
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const sf = slug === "demo" ? null : await loadStorefront(slug);
  if (!sf || !sf.indexable) return new Response("Not found", { status: 404 });
  const base = await canonicalBase(sf);
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const urls = ["/", "/shop/", "/about/", "/contact/", ...sf.categories.map((c) => `/shop/?c=${c.slug}`), ...sf.products.map((p) => `/products/${p.slug}/`),
    ...(["shipping", "refund", "privacy", "terms"] as const).filter((k) => sf.settings.policies[k]).map((k) => `/policies/${k}/`)];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${esc(base + u)}</loc></url>`).join("\n")}\n</urlset>\n`;
  return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
