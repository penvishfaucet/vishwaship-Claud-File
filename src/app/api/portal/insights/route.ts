import { NextResponse } from "next/server";
import { apiCustomer } from "@/server/auth/session";
import { apiError } from "@/server/http";
import { buyerInsights, pinInsights } from "@/server/insights";
import { rateLimit } from "@/server/security/rate-limit";

/** Courier delivery / RTO rates for a PIN and the buyer's delivery record (aggregated; no other client's details). */
export async function GET(req: Request) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  if (!(await rateLimit(`insights:${s.userId}`, 120, 60)).ok) return apiError(429, "rate_limited", "Too many lookups — wait a moment");
  const u = new URL(req.url);
  const pin = (u.searchParams.get("pin") ?? "").trim();
  const mobile = (u.searchParams.get("mobile") ?? "").trim();
  const [carriers, buyer] = await Promise.all([pinInsights(pin), buyerInsights(mobile)]);
  return NextResponse.json({ carriers, buyer }, { headers: { "cache-control": "private, max-age=300" } });
}
