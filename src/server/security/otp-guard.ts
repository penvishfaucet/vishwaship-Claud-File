import "server-only";
import { getSetting } from "@/server/quotes/service";
import { rateLimit } from "@/server/security/rate-limit";

/**
 * OTP send guard (owner 2026-11-26): every Firebase SMS costs money, so the browser asks the server BEFORE Firebase
 * sends one. Limits per mobile number (cannot be faked), per IP, and a site-wide daily cap that stops a runaway
 * Firebase bill even if an attacker uses many numbers. Firebase itself additionally needs a solved reCAPTCHA per SMS.
 * Admin can change the numbers in Admin → Security.
 */
export type OtpGuardConfig = { perMobile15m: number; perMobileDay: number; perIpHour: number; perIpDay: number; siteDay: number };
export const OTP_GUARD_DEFAULTS: OtpGuardConfig = { perMobile15m: 3, perMobileDay: 8, perIpHour: 10, perIpDay: 30, siteDay: 500 };

export const otpGuardConfig = async (): Promise<OtpGuardConfig> => ({ ...OTP_GUARD_DEFAULTS, ...(await getSetting<Partial<OtpGuardConfig>>("otp_guard", OTP_GUARD_DEFAULTS)).value });

export type OtpPurpose = "login" | "staff" | "store" | "pickup";

/** Today's IST date, for the daily counters. */
const day = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

export async function otpAllowed(a: { mobile: string; ip: string; purpose: OtpPurpose }): Promise<{ ok: true } | { ok: false; message: string; retryAfter: number }> {
  const c = await otpGuardConfig();
  const m = a.mobile.replace(/\D/g, "").slice(-10);
  const checks: Array<[string, number, number, string]> = [
    [`otp:m15:${m}`, c.perMobile15m, 900, "Too many OTPs for this number. Please wait 15 minutes and try again."],
    [`otp:md:${m}:${day()}`, c.perMobileDay, 86_400, "Daily OTP limit reached for this number. Please try again tomorrow or use email login."],
    [`otp:ih:${a.ip}`, c.perIpHour, 3600, "Too many OTP requests from your network. Please wait an hour or use email login."],
    [`otp:id:${a.ip}:${day()}`, c.perIpDay, 86_400, "Too many OTP requests from your network today. Please use email login."],
    [`otp:site:${day()}`, c.siteDay, 86_400, "Mobile OTP is busy right now. Please use email login, or try again later."],
  ];
  for (const [key, limit, win, message] of checks) {
    const r = await rateLimit(key, limit, win);
    if (!r.ok) return { ok: false, message, retryAfter: r.retryAfter };
  }
  return { ok: true };
}
