import { NextResponse } from "next/server";
import { z } from "zod";
import { readSettings } from "@/lib/store-themes";
import { apiError, parseJson } from "@/server/http";
import { rateLimit, ipFromHeaders } from "@/server/security/rate-limit";
import { currentBuyer, rememberAddress } from "@/server/store/buyers";
import { CheckoutError, CheckoutInput, PAY_METHODS, assertOrdersOpen, confirmCheckoutPayment, liveStore, placeOrder, quoteCart } from "@/server/store/checkout";

type Ctx = { params: Promise<{ slug: string }> };
const ip = (req: Request) => ipFromHeaders(req.headers);
const fail = (e: unknown) => {
  if (e instanceof CheckoutError) return apiError(422, "validation_error", e.message, e.field ? { field: e.field } : undefined);
  console.error("[store checkout]", (e as Error).message);
  return apiError(502, "provider_error", "Something went wrong. Please try again.");
};

const QuoteBody = z.object({ lines: CheckoutInput.shape.lines, coupon: z.string().trim().toUpperCase().max(30).default(""), paymentMethod: z.enum(PAY_METHODS).optional() });

/** PUT = price the cart (no side effects). POST = place the order. PATCH = confirm an online payment. */
export async function PUT(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  if (!(await rateLimit(`sf-quote:${ip(req)}`, 120, 600)).ok) return apiError(429, "rate_limited", "Too many requests. Please wait a minute.");
  const p = await parseJson(req, QuoteBody); if (!p.ok) return p.res;
  try {
    const store = await liveStore(slug);
    assertOrdersOpen(store);
    const q = await quoteCart(store, p.data.lines, p.data.coupon, p.data.paymentMethod);
    return NextResponse.json({
      lines: q.lines.map((l) => ({ productId: l.productId, variantId: l.variantId, title: l.title, variantTitle: l.variantTitle, qty: l.qty, unitPaise: l.unitPaise })),
      subtotalPaise: q.subtotalPaise, discountPaise: q.discountPaise, shippingPaise: q.shippingPaise, codFeePaise: q.codFeePaise, totalPaise: q.totalPaise,
      coupon: q.coupon?.code ?? null, codAllowed: q.codAllowed, codReason: q.codReason, onlineAllowed: q.onlineAllowed, onlineMethod: q.onlineMethod, codFeeIfCod: readSettings(store.settings).checkout.codFeePaise,
    });
  } catch (e) { return fail(e); }
}

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  if (!(await rateLimit(`sf-checkout:${ip(req)}`, 20, 600)).ok) return apiError(429, "rate_limited", "Too many attempts. Please wait a few minutes.");
  const p = await parseJson(req, CheckoutInput); if (!p.ok) return p.res;
  // keep only known attribution fields; IP and browser are kept only when the buyer allowed marketing cookies
  const a = p.data.attribution;
  const consent = ["analytics", "marketing"].filter((k) => (a.consent ?? "").split(",").includes(k)).join(",");
  const keep = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "gclid", "landing", "at"];
  const marketingKeys = consent.includes("marketing") ? ["fbp", "fbc"] : [];
  const analyticsKeys = consent.includes("analytics") ? ["gaClientId"] : [];
  const clean: Record<string, string> = Object.fromEntries(Object.entries(a).filter(([k]) => [...keep, ...marketingKeys, ...analyticsKeys].includes(k)));
  if (consent) clean.consent = consent;
  if (consent.includes("marketing")) { clean.ip = ip(req).slice(0, 60); clean.ua = (req.headers.get("user-agent") ?? "").slice(0, 300); }
  try {
    // logged-in buyer (My Account): link the order and remember a new delivery address
    const me = await currentBuyer((await liveStore(slug, { allowExpired: true })).id);
    const r = await placeOrder(slug, { ...p.data, attribution: clean }, { buyerId: me?.id ?? null });
    if (me) await rememberAddress(me.id, p.data.buyer).catch(() => null);
    return NextResponse.json(r);
  } catch (e) { return fail(e); }
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  if (!(await rateLimit(`sf-pay:${ip(req)}`, 30, 600)).ok) return apiError(429, "rate_limited", "Too many attempts. Please wait a few minutes.");
  const p = await parseJson(req, z.object({ orderId: z.string().max(60), token: z.string().max(60), rzOrderId: z.string().max(60), paymentId: z.string().max(60), signature: z.string().max(200) })); if (!p.ok) return p.res;
  try { return NextResponse.json(await confirmCheckoutPayment(slug, p.data)); } catch (e) { return fail(e); }
}
