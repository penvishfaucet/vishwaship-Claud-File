import { NextResponse } from "next/server";
import { z } from "zod";
import { readSettings } from "@/lib/store-themes";
import { apiError, parseJson } from "@/server/http";
import { rateLimit } from "@/server/security/rate-limit";
import { CheckoutError, CheckoutInput, confirmCheckoutPayment, liveStore, placeOrder, quoteCart } from "@/server/store/checkout";

type Ctx = { params: Promise<{ slug: string }> };
const ip = (req: Request) => (req.headers.get("x-forwarded-for")?.split(",")[0] ?? "local").trim();
const fail = (e: unknown) => {
  if (e instanceof CheckoutError) return apiError(422, "validation_error", e.message, e.field ? { field: e.field } : undefined);
  console.error("[store checkout]", (e as Error).message);
  return apiError(502, "provider_error", "Something went wrong. Please try again.");
};

const QuoteBody = z.object({ lines: CheckoutInput.shape.lines, coupon: z.string().trim().toUpperCase().max(30).default(""), paymentMethod: z.enum(["cod", "razorpay"]).optional() });

/** PUT = price the cart (no side effects). POST = place the order. PATCH = confirm an online payment. */
export async function PUT(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  if (!(await rateLimit(`sf-quote:${ip(req)}`, 120, 600)).ok) return apiError(429, "rate_limited", "Too many requests. Please wait a minute.");
  const p = await parseJson(req, QuoteBody); if (!p.ok) return p.res;
  try {
    const store = await liveStore(slug);
    const q = await quoteCart(store, p.data.lines, p.data.coupon, p.data.paymentMethod);
    return NextResponse.json({
      lines: q.lines.map((l) => ({ productId: l.productId, variantId: l.variantId, title: l.title, variantTitle: l.variantTitle, qty: l.qty, unitPaise: l.unitPaise })),
      subtotalPaise: q.subtotalPaise, discountPaise: q.discountPaise, shippingPaise: q.shippingPaise, codFeePaise: q.codFeePaise, totalPaise: q.totalPaise,
      coupon: q.coupon?.code ?? null, codAllowed: q.codAllowed, codReason: q.codReason, onlineAllowed: q.onlineAllowed, codFeeIfCod: readSettings(store.settings).checkout.codFeePaise,
    });
  } catch (e) { return fail(e); }
}

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  if (!(await rateLimit(`sf-checkout:${ip(req)}`, 20, 600)).ok) return apiError(429, "rate_limited", "Too many attempts. Please wait a few minutes.");
  const p = await parseJson(req, CheckoutInput); if (!p.ok) return p.res;
  try { return NextResponse.json(await placeOrder(slug, p.data)); } catch (e) { return fail(e); }
}

export async function PATCH(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  if (!(await rateLimit(`sf-pay:${ip(req)}`, 30, 600)).ok) return apiError(429, "rate_limited", "Too many attempts. Please wait a few minutes.");
  const p = await parseJson(req, z.object({ orderId: z.string().max(60), token: z.string().max(60), rzOrderId: z.string().max(60), paymentId: z.string().max(60), signature: z.string().max(200) })); if (!p.ok) return p.res;
  try { return NextResponse.json(await confirmCheckoutPayment(slug, p.data)); } catch (e) { return fail(e); }
}
