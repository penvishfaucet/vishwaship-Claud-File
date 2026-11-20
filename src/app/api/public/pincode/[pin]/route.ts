import { NextResponse } from "next/server";
import { apiError } from "@/server/http";
import { lookupPincode } from "@/server/pincode";
import { clientIp, rateLimit } from "@/server/security/rate-limit";

/** Public rate calculator: City/District and State for a PIN code (only the PIN is sent to the directory). */
export async function GET(req: Request, { params }: { params: Promise<{ pin: string }> }) {
  const { pin } = await params;
  if (!/^[1-9]\d{5}$/.test(pin)) return apiError(422, "validation_error", "Enter a valid 6-digit pincode.");
  if (!(await rateLimit(`pubpin:${clientIp(req)}`, 60, 60)).ok) return apiError(429, "rate_limited", "Too many lookups — wait a moment");
  const r = await lookupPincode(pin);
  if (r.status === "not_found") return apiError(404, "not_found", "Invalid pincode. Please check and try again.");
  if (r.status === "error") return apiError(502, "provider_error", "PIN lookup is unavailable right now — you can still get rates");
  return NextResponse.json({ pin, city: r.city, state: r.state, locality: r.locality ?? null }, { headers: { "cache-control": "public, max-age=86400" } });
}
