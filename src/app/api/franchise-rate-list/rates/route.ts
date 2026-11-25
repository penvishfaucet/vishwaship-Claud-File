import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { addMargin } from "@/lib/franchise-rates";
import { getFranchiseRateSettings } from "@/server/franchise-rates/settings";
import { apiError } from "@/server/http";
import { MSG, PublicRatesInput, pinView, publicRates } from "@/server/quotes/public-rates";
import { clientIp, rateLimit } from "@/server/security/rate-limit";
import { getSiteContent } from "@/server/site/content";

/**
 * Franchise Rate List calculator: exactly the public calculator (B2C + B2B together), with the admin-set
 * franchise margin (default 10%) added to every line, COD charge included.
 */
export async function POST(req: Request) {
  const rl = await rateLimit(`frrates:${clientIp(req)}`, 20, 60);
  if (!rl.ok) return apiError(429, "rate_limited", "Too many rate checks. Please wait a minute and try again.", { retryAfter: rl.retryAfter });
  const site = await getSiteContent().catch(() => null);
  if (site && !site.features.calculator) return apiError(503, "provider_error", site.features.unavailableText);

  let body: unknown;
  try { body = await req.json(); } catch { return apiError(400, "validation_error", "Body must be JSON"); }
  let v;
  try { v = PublicRatesInput.parse(body); }
  catch (e) {
    const fields: Record<string, string> = {};
    if (e instanceof ZodError) for (const i of e.issues) {
      const k = i.path[0] === "originPincode" ? "origin" : i.path[0] === "destinationPincode" ? "dest" : i.path[0] === "codAmountRupees" ? "cod" : i.path[0] === "paymentType" ? "pay" : i.path[0] === "declaredValueRupees" ? "value" : "packages";
      fields[k] ??= i.message;
    }
    return apiError(422, "validation_error", "Please check the highlighted fields.", { fields });
  }

  try {
    const r = await publicRates(v);
    const pins = { origin: pinView(r.pins.origin.result), dest: pinView(r.pins.dest.result) };
    if (!r.ok) return apiError(422, "validation_error", MSG.pinUnknown, { fields: r.fieldErrors, pins });
    const { marginBps } = await getFranchiseRateSettings();
    const offers = r.offers.map((o) => addMargin(o, marginBps)).sort((a, b) => a.total - b.total);
    return NextResponse.json({ offers, services: r.services, empty: r.empty, pins, chargeableKg: r.chargeableKg });
  } catch (e) {
    console.error("[franchise-rates]", (e as Error).message);
    return apiError(503, "provider_error", MSG.retry);
  }
}
