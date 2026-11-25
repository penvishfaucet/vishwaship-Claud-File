import { NextResponse } from "next/server";
import { z } from "zod";
import { audit } from "@/server/audit";
import { apiError, parseJson } from "@/server/http";
import { otpAllowed } from "@/server/security/otp-guard";
import { clientIp } from "@/server/security/rate-limit";

/** Asked by the browser right before Firebase sends an OTP SMS: allowed only within the OTP limits. */
const Body = z.object({
  mobile: z.string().transform((v) => v.replace(/\D/g, "").slice(-10)).pipe(z.string().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile number")),
  purpose: z.enum(["login", "staff", "store", "pickup"]).default("login"),
});

export async function POST(req: Request) {
  const p = await parseJson(req, Body);
  if (!p.ok) return p.res;
  const ip = clientIp(req);
  const r = await otpAllowed({ mobile: p.data.mobile, ip, purpose: p.data.purpose });
  if (!r.ok) {
    await audit({ actorKind: "system", action: "otp.blocked", details: { purpose: p.data.purpose, mobileLast4: p.data.mobile.slice(-4), ip, reason: r.message } }).catch(() => {});
    return apiError(429, "rate_limited", r.message, { retryAfter: r.retryAfter });
  }
  return NextResponse.json({ ok: true });
}
