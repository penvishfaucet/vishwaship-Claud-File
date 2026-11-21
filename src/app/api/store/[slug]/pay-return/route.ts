import { NextResponse } from "next/server";
import { rateLimit } from "@/server/security/rate-limit";
import { CheckoutError, confirmGatewayReturn } from "@/server/store/checkout";

/**
 * Buyer comes back from Cashfree / PhonePe (GET redirect) or Paytm (POST form). Whatever the gateway sends here is
 * ignored: the order is checked with the gateway's status API, then the buyer lands on their order page.
 */
async function handle(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const u = new URL(req.url);
  const o = u.searchParams.get("o") ?? "", t = u.searchParams.get("t") ?? "";
  const back = (path: string) => NextResponse.redirect(new URL(path, u.origin), 303);
  const ip = (req.headers.get("x-forwarded-for")?.split(",")[0] ?? "local").trim();
  if (!(await rateLimit(`sf-payret:${ip}`, 40, 600)).ok || !/^[A-Za-z0-9_-]{4,60}$/.test(o) || !/^[A-Za-z0-9_-]{8,60}$/.test(t)) return back(`/s/${encodeURIComponent(slug)}/`);
  try {
    const r = await confirmGatewayReturn(slug, o, t);
    return back(`/s/${encodeURIComponent(slug)}/order/${encodeURIComponent(r.number)}/?t=${encodeURIComponent(r.token)}${r.state === "failed" ? "&pay=failed" : ""}`);
  } catch (e) {
    if (!(e instanceof CheckoutError)) console.error("[store pay-return]", (e as Error).message);
    return back(`/s/${encodeURIComponent(slug)}/`);
  }
}

export const GET = handle;
export const POST = handle;
