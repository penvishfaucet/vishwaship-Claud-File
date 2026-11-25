import { NextResponse } from "next/server";
import { getFranchiseRateSettings } from "@/server/franchise-rates/settings";
import { apiError, parseJson } from "@/server/http";
import { QuoteInput, toQuoteRequest } from "@/server/quotes/input";
import { presentNotices, presentOffer } from "@/server/quotes/present";
import { getQuotes } from "@/server/quotes/service";
import { clientIp, rateLimit } from "@/server/security/rate-limit";

/**
 * Franchise Rate List calculator: the live courier cost from every active service (Shipmozo B2C/B2B, Delhivery B2B,
 * Shipora X …) plus exactly the franchise margin (Admin → Franchise Rate List, default 10%), GST once on the result —
 * the same pricing engine as the Customer Portal calculator. Nothing is saved; booking re-quotes on the client's account.
 */
export async function POST(req: Request) {
  const rl = await rateLimit(`frquote:${clientIp(req)}`, 30, 60);
  if (!rl.ok) return apiError(429, "rate_limited", "Too many rate checks. Please wait a minute.", { retryAfter: rl.retryAfter });
  const p = await parseJson(req, QuoteInput);
  if (!p.ok) return p.res;
  const { marginBps } = await getFranchiseRateSettings();
  const { offers, errors } = await getQuotes(toQuoteRequest(p.data), null, { persist: false, markupBps: marginBps });
  return NextResponse.json({ offers: offers.filter((o) => !o.isDemo).sort((a, b) => a.total - b.total).map(presentOffer), notices: presentNotices(errors) });
}
