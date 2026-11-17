import { NextResponse } from "next/server";
import { apiCustomer } from "@/server/auth/session";
import { apiError } from "@/server/http";
import { lookupPincode } from "@/server/pincode";
import { rateLimit } from "@/server/security/rate-limit";

export async function GET(_req: Request, { params }: { params: Promise<{ pin: string }> }) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const { pin } = await params;
  if (!/^[1-9]\d{5}$/.test(pin)) return apiError(422, "validation_error", "Enter a valid 6-digit PIN code");
  if (!(await rateLimit(`pin:${s.userId}`, 120, 60)).ok) return apiError(429, "rate_limited", "Too many lookups — wait a moment");
  const r = await lookupPincode(pin);
  if (r.status === "not_found") return apiError(404, "not_found", "No match for this PIN code — check it or enter City and State yourself");
  if (r.status === "error") return apiError(502, "provider_error", r.message);
  return NextResponse.json({ pin, city: r.city, state: r.state, source: r.source, partial: !!r.partial }, { headers: { "cache-control": "private, max-age=86400" } });
}
