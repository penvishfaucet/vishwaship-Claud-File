import { NextResponse } from "next/server";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import { apiError } from "@/server/http";
import { getDb, schema } from "@/server/db/client";
import { rateLimit, ipFromHeaders } from "@/server/security/rate-limit";
import { CheckoutError, liveStore } from "@/server/store/checkout";

/** GET ?q=bra → up to 6 search suggestions (active products of a live store: name, SKU or slug). No prices (sales change them). */
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const ip = ipFromHeaders(req.headers);
  if (!(await rateLimit(`sf-search:${ip}`, 120, 600)).ok) return apiError(429, "rate_limited", "Too many searches. Please wait a minute.");
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().replace(/[%_\\]/g, "").slice(0, 60);
  if (q.length < 2) return NextResponse.json({ items: [] });
  try {
    const store = await liveStore(slug);
    const db = await getDb();
    const like = `%${q}%`;
    const rows = await db.select({ title: schema.storeProducts.title, slug: schema.storeProducts.slug, images: schema.storeProducts.images })
      .from(schema.storeProducts)
      .where(and(eq(schema.storeProducts.storeId, store.id), eq(schema.storeProducts.status, "active"),
        or(ilike(schema.storeProducts.title, like), ilike(schema.storeProducts.sku, like), ilike(schema.storeProducts.slug, like))))
      .orderBy(desc(schema.storeProducts.featured), schema.storeProducts.title).limit(6);
    const img = (ref: string | undefined) => (ref ? (ref.startsWith("sm_") ? `/api/store-media/${ref}/` : ref) : null);
    return NextResponse.json({ items: rows.map((r) => ({ title: r.title, slug: r.slug, image: img((r.images as string[])[0]) })) }, { headers: { "cache-control": "private, max-age=60" } });
  } catch (e) {
    if (e instanceof CheckoutError) return apiError(404, "not_found", e.message);
    console.error("[store search]", (e as Error).message);
    return NextResponse.json({ items: [] });
  }
}
