import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, parseJson } from "@/server/http";
import { requestSignupOtp } from "@/server/auth/signup-otp";

/** POST { email } → sends a 6-digit signup code (never returned in the response). */
export async function POST(req: Request) {
  const p = await parseJson(req, z.object({ email: z.string().max(200) }));
  if (!p.ok) return p.res;
  const ip = (req.headers.get("x-forwarded-for")?.split(",")[0] ?? "local").trim();
  const r = await requestSignupOtp(p.data.email, ip);
  if (!r.ok) return apiError(r.code === "exists" ? 409 : r.code === "invalid" ? 422 : r.code === "send_failed" ? 502 : 429, r.code === "exists" ? "conflict" : r.code === "invalid" ? "validation_error" : r.code === "send_failed" ? "provider_error" : "rate_limited", r.message, { reason: r.code, retryInSec: r.retryInSec });
  return NextResponse.json({ sent: true, cooldownSec: r.cooldownSec, validityMin: r.validityMin });
}
