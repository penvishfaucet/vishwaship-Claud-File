import { presentNotices, presentOffer } from "@/server/quotes/present";
import { NextResponse } from "next/server";
import { apiCustomer } from "@/server/auth/session";
import { apiError, parseJson } from "@/server/http";
import { QuoteInput, toQuoteRequest } from "@/server/quotes/input";
import { getQuotes } from "@/server/quotes/service";
import { rateLimit } from "@/server/security/rate-limit";

/** Customer quotes: markup chosen on the server from the session's org (override or global). */
export async function POST(req: Request) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const rl = await rateLimit(`quote:${s.orgId}`, 120, 60);
  if (!rl.ok) return apiError(429, "rate_limited", "Too many rate checks", { retryAfter: rl.retryAfter });
  const p = await parseJson(req, QuoteInput);
  if (!p.ok) return p.res;
  const { offers, errors } = await getQuotes(toQuoteRequest(p.data), s.orgId);
  return NextResponse.json({
    offers: offers.map(presentOffer),
    unavailable: errors.length,
    notices: presentNotices(errors),
  });
}
