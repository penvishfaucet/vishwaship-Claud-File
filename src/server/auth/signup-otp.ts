import "server-only";
import { randomInt } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { hmacSha256Hex, safeEqual } from "@/server/security/crypto";
import { rateLimit } from "@/server/security/rate-limit";
import { newId } from "@/server/util/ids";
import { getAuthSettings, sendEmail } from "@/server/email/service";
import type { EmailEventKey } from "@/lib/email-events";

/**
 * Email one-time codes for account sign-up and for Forgot password.
 * Same rules for both (Admin → Email & Sign-in → OTP Settings): single use, expiry, resend cooldown, attempt limit.
 * Codes are stored only as an HMAC; a new code cancels every earlier unused code of the same purpose.
 */
type Purpose = "signup" | "reset";
const EVENT: Record<Purpose, EmailEventKey> = { signup: "signup_otp", reset: "password_reset_otp" };
const hash = (p: Purpose, email: string, code: string) => hmacSha256Hex(process.env.APP_ENCRYPTION_KEY ?? "dev", `${p === "signup" ? "signup-otp" : "reset-otp"}:${email}:${code}`);
export const normEmail = (e: string) => e.trim().toLowerCase();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function customerByEmail(email: string) {
  const db = await getDb();
  const [u] = await db.select({ id: schema.users.id, name: schema.users.name, active: schema.users.active }).from(schema.users).where(and(eq(schema.users.kind, "customer"), eq(schema.users.email, email)));
  return u ?? null;
}

export type OtpSendResult =
  | { ok: true; cooldownSec: number; validityMin: number; delivered: boolean }
  | { ok: false; code: "invalid" | "exists" | "no_account" | "cooldown" | "rate_limited" | "send_failed"; message: string; retryInSec?: number };

async function requestOtp(purpose: Purpose, rawEmail: string, ip: string): Promise<OtpSendResult> {
  const email = normEmail(rawEmail);
  if (!EMAIL_RE.test(email) || email.length > 160) return { ok: false, code: "invalid", message: "Enter a valid email address" };
  const user = await customerByEmail(email);
  if (purpose === "signup" && user) return { ok: false, code: "exists", message: "An account with this email already exists. Log in, or use Forgot password to recover it." };
  if (purpose === "reset" && (!user || !user.active)) return { ok: false, code: "no_account", message: "No Vishwaship account uses this email. Check the spelling, or create a new account." };
  const cfg = await getAuthSettings();
  if (!(await rateLimit(`${purpose}-otp:ip:${ip}`, 20, 3600)).ok || !(await rateLimit(`${purpose}-otp:em:${email}`, 6, 3600)).ok) return { ok: false, code: "rate_limited", message: "Too many codes requested. Please try again in an hour." };
  const db = await getDb();
  const [last] = await db.select().from(schema.otpChallenges).where(and(eq(schema.otpChallenges.target, email), eq(schema.otpChallenges.purpose, purpose))).orderBy(desc(schema.otpChallenges.createdAt)).limit(1);
  if (last && !last.verifiedAt) {
    const wait = Math.ceil((last.createdAt.getTime() + cfg.otpCooldownSec * 1000 - Date.now()) / 1000);
    if (wait > 0) return { ok: false, code: "cooldown", message: `Please wait ${wait} s before requesting a new code`, retryInSec: wait };
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await db.delete(schema.otpChallenges).where(and(eq(schema.otpChallenges.target, email), eq(schema.otpChallenges.purpose, purpose), isNull(schema.otpChallenges.verifiedAt)));
  await db.insert(schema.otpChallenges).values({ id: newId("otp"), target: email, purpose, codeHash: hash(purpose, email, code), expiresAt: new Date(Date.now() + cfg.otpValidityMin * 60_000) });
  const validity = `${cfg.otpValidityMin} minute${cfg.otpValidityMin === 1 ? "" : "s"}`;
  const r = await sendEmail({ event: EVENT[purpose], to: email, toKind: "signup", vars: { customer_name: user?.name ?? "", otp: code, otp_validity: validity }, ignoreRule: true });
  if (r.status === "failed") return { ok: false, code: "send_failed", message: "We could not send the code right now. Please try again in a minute." };
  return { ok: true, cooldownSec: cfg.otpCooldownSec, validityMin: cfg.otpValidityMin, delivered: r.status === "sent" };
}

async function consumeOtp(purpose: Purpose, rawEmail: string, code: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const email = normEmail(rawEmail);
  const cfg = await getAuthSettings();
  const db = await getDb();
  const [c] = await db.select().from(schema.otpChallenges).where(and(eq(schema.otpChallenges.target, email), eq(schema.otpChallenges.purpose, purpose), isNull(schema.otpChallenges.verifiedAt))).orderBy(desc(schema.otpChallenges.createdAt)).limit(1);
  if (!c) return { ok: false, message: "Request a verification code for this email first" };
  if (c.expiresAt.getTime() < Date.now()) return { ok: false, message: "This code has expired. Tap Resend OTP for a new one." };
  if (c.attempts >= cfg.otpMaxAttempts) return { ok: false, message: "Too many wrong attempts. Tap Resend OTP for a new code." };
  if (!/^\d{6}$/.test(code.trim()) || !safeEqual(c.codeHash, hash(purpose, email, code.trim()))) {
    const attempts = c.attempts + 1;
    await db.update(schema.otpChallenges).set({ attempts }).where(eq(schema.otpChallenges.id, c.id));
    const left = cfg.otpMaxAttempts - attempts;
    return { ok: false, message: left > 0 ? `Incorrect code. ${left} attempt${left === 1 ? "" : "s"} left.` : "Too many wrong attempts. Tap Resend OTP for a new code." };
  }
  // single use: mark verified so the same code can never be used twice
  const used = await db.update(schema.otpChallenges).set({ verifiedAt: new Date() }).where(and(eq(schema.otpChallenges.id, c.id), isNull(schema.otpChallenges.verifiedAt))).returning({ id: schema.otpChallenges.id });
  if (!used.length) return { ok: false, message: "This code was already used" };
  return { ok: true };
}

/** Sign-up code for a new email (an email that already has an account is refused). */
export const requestSignupOtp = (email: string, ip: string) => requestOtp("signup", email, ip);
export const consumeSignupOtp = (email: string, code: string) => consumeOtp("signup", email, code);
/** Forgot password code for an existing, active customer account. */
export const requestResetOtp = (email: string, ip: string) => requestOtp("reset", email, ip);
export const consumeResetOtp = (email: string, code: string) => consumeOtp("reset", email, code);
