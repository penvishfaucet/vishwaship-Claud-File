import { NextResponse } from "next/server";
import { apiError, parseJson } from "@/server/http";
import { QuoteInput, toQuoteRequest } from "@/server/quotes/input";
import { getQuotes } from "@/server/quotes/service";
import { clientIp, rateLimit } from "@/server/security/rate-limit";

/** Public calculator: always priced with the global markup (orgId = null). */
export async function POST(req: Request) {
  const rl = await rateLimit(`pubquote:${clientIp(req)}`, 30, 60);
  if (!rl.ok) return apiError(429, "rate_limited", "Too many rate checks. Please wait a minute.", { retryAfter: rl.retryAfter });
  const p = await parseJson(req, QuoteInput);
  if (!p.ok) return p.res;
  const { offers } = await getQuotes(toQuoteRequest(p.data), null);
  // Public view: no cost, markup or provider internals.
  return NextResponse.json({
    offers: offers.map((o) => ({
      quoteId: o.quoteId, carrierCode: o.carrierCode, carrierName: o.carrierName, serviceName: o.serviceName,
      mode: o.mode, etaDays: o.etaDays, chargeableWeightGrams: o.chargeableWeightGrams,
      lines: o.lines.map((l) => ({ code: l.code, label: l.label, sellPreTax: l.sellPreTax })),
      sellingSubtotal: o.sellingSubtotal, gst: o.gst, total: o.total, expiresAt: o.expiresAt, isDemo: o.isDemo,
    })),
  });
}
