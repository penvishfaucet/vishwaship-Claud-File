import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { rateLimit } from "@/server/security/rate-limit";
import { recordVisit } from "@/server/store/analytics";

/** Storefront page-view beacon (live stores only). Bots and floods are capped per IP. */
export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const ip = (req.headers.get("x-forwarded-for")?.split(",")[0] ?? "local").trim();
  if (!(await rateLimit(`sf-visit:${ip}`, 120, 600)).ok) return new NextResponse(null, { status: 204 });
  if (/bot|crawl|spider|preview/i.test(req.headers.get("user-agent") ?? "")) return new NextResponse(null, { status: 204 });
  let vid: string | null = null;
  try { const j = await req.json(); vid = typeof j?.vid === "string" ? j.vid : null; } catch { /* empty beacon */ }
  const db = await getDb();
  const [s] = await db.select({ id: schema.stores.id, status: schema.stores.status }).from(schema.stores).where(eq(schema.stores.slug, slug));
  if (s?.status === "live") await recordVisit(s.id, vid);
  return new NextResponse(null, { status: 204 });
}
