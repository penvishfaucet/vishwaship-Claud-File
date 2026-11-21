import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, parseJson } from "@/server/http";
import { rateLimit } from "@/server/security/rate-limit";
import { StoreError } from "@/server/store/catalog";
import { CheckoutError, liveStore } from "@/server/store/checkout";
import { ReviewInput, addReview } from "@/server/store/reviews";

type Ctx = { params: Promise<{ slug: string }> };
const ip = (req: Request) => (req.headers.get("x-forwarded-for")?.split(",")[0] ?? "local").trim();

/** A buyer posts a product review (published at once). Capped per IP to stop floods. */
export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  if (!(await rateLimit(`sf-review:${ip(req)}`, 5, 3600)).ok) return apiError(429, "rate_limited", "You have posted several reviews. Please try again later.");
  const p = await parseJson(req, ReviewInput.extend({ productId: z.string().max(60) })); if (!p.ok) return p.res;
  try {
    const store = await liveStore(slug);
    const r = await addReview(store, p.data.productId, p.data);
    return NextResponse.json({ ok: true, verified: r.verified });
  } catch (e) {
    if (e instanceof StoreError || e instanceof CheckoutError) return apiError(422, "validation_error", e.message);
    throw e;
  }
}
