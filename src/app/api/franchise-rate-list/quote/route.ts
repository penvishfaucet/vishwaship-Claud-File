import { NextResponse } from "next/server";
import { getFranchiseRateSettings } from "@/server/franchise-rates/settings";
import { getRateLink } from "@/server/franchise-rates/links";
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
  // a personal link (?link=…) may include Shipora X rates; the standard page never does
  const link = await getRateLink(new URL(req.url).searchParams.get("link"));
  const { offers, errors } = await getQuotes(toQuoteRequest(p.data), null, { persist: false, markupBps: marginBps, includeRestricted: !!link?.shipora });
  const list = offers.filter((o) => !o.isDemo).sort((a, b) => a.total - b.total).map(presentOffer);
  // Public page: service set-up notes ("GST basis not set" etc.) are for Admin only; show them only when nothing priced.
  return NextResponse.json({ offers: list, notices: list.length ? [] : presentNotices(errors).length ? ["No courier service could price this shipment right now."] : [] });
}
