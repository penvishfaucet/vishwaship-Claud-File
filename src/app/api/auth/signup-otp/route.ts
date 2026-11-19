import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, parseJson } from "@/server/http";
import { requestResetOtp, requestSignupOtp } from "@/server/auth/signup-otp";

/** POST { email, purpose?: "signup" | "reset" } → sends a 6-digit code (never returned in the response). */
export async function POST(req: Request) {
  const p = await parseJson(req, z.object({ email: z.string().max(200), purpose: z.enum(["signup", "reset"]).default("signup") }));
  if (!p.ok) return p.res;
  const ip = (req.headers.get("x-forwarded-for")?.split(",")[0] ?? "local").trim();
  const r = p.data.purpose === "reset" ? await requestResetOtp(p.data.email, ip) : await requestSignupOtp(p.data.email, ip);
  if (!r.ok) {
    const status = r.code === "exists" ? 409 : r.code === "no_account" ? 404 : r.code === "invalid" ? 422 : r.code === "send_failed" ? 502 : 429;
    const code = r.code === "exists" ? "conflict" : r.code === "no_account" ? "not_found" : r.code === "invalid" ? "validation_error" : r.code === "send_failed" ? "provider_error" : "rate_limited";
    return apiError(status, code, r.message, { reason: r.code, retryInSec: r.retryInSec });
  }
  return NextResponse.json({ sent: true, cooldownSec: r.cooldownSec, validityMin: r.validityMin });
}
