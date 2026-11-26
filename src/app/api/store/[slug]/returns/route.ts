import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, parseJson } from "@/server/http";
import { rateLimit, ipFromHeaders } from "@/server/security/rate-limit";
import { currentBuyer } from "@/server/store/buyers";
import { CheckoutError, liveStore } from "@/server/store/checkout";
import { buyerOrder, buyerOwnOrder } from "@/server/store/orders";
import { ReturnError, requestReturn } from "@/server/store/returns";

/** Buyer asks for a return / exchange. Allowed for the logged-in owner of the order, or with the order page's secret link. */
const Body = z.object({ number: z.string().max(40), token: z.string().max(80).default(""), request: z.unknown() });

export async function POST(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const ip = ipFromHeaders(req.headers);
  if (!(await rateLimit(`sf-return:${ip}`, 10, 600)).ok) return apiError(429, "rate_limited", "Too many attempts. Please wait a few minutes.");
  const p = await parseJson(req, Body); if (!p.ok) return p.res;
  try {
    const store = await liveStore(slug, { allowExpired: true });
    const me = await currentBuyer(store.id);
    const o = (me ? await buyerOwnOrder(me, p.data.number) : null) ?? (p.data.token ? await buyerOrder(store.id, p.data.number, p.data.token) : null);
    if (!o) return apiError(404, "not_found", "Order not found. Log in with the mobile or email you ordered with.");
    const r = await requestReturn(store, o, p.data.request);
    return NextResponse.json({ ok: true, request: r });
  } catch (e) {
    if (e instanceof z.ZodError) return apiError(422, "validation_error", e.issues[0]?.message ?? "Check the details");
    if (e instanceof ReturnError) return apiError(422, "validation_error", e.message);
    if (e instanceof CheckoutError) return apiError(404, "not_found", e.message);
    console.error("[store return]", (e as Error).message);
    return apiError(502, "provider_error", "Something went wrong. Please try again.");
  }
}
