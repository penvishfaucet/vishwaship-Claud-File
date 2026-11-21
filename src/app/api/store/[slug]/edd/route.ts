import { NextResponse } from "next/server";
import { apiError } from "@/server/http";
import { rateLimit } from "@/server/security/rate-limit";
import { CheckoutError, liveStore } from "@/server/store/checkout";
import { storeEdd } from "@/server/store/edd";

/** GET ?pin=110001 → delivery date estimate for that pincode (no courier names). */
export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const ip = (req.headers.get("x-forwarded-for")?.split(",")[0] ?? "local").trim();
  if (!(await rateLimit(`sf-edd:${ip}`, 30, 600)).ok) return apiError(429, "rate_limited", "Too many checks. Please wait a minute.");
  const pin = new URL(req.url).searchParams.get("pin") ?? "";
  if (!/^[1-9]\d{5}$/.test(pin)) return apiError(422, "validation_error", "Enter a valid 6-digit pincode");
  try {
    const store = await liveStore(slug);
    return NextResponse.json(await storeEdd(store, pin), { headers: { "cache-control": "private, max-age=600" } });
  } catch (e) {
    if (e instanceof CheckoutError) return apiError(404, "not_found", e.message);
    console.error("[store edd]", (e as Error).message);
    return NextResponse.json({ serviceable: false });
  }
}
