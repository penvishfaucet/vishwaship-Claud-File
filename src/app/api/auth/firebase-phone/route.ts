import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/server/audit";
import { createCustomerAccount } from "@/server/auth/accounts";
import { PhoneTokenError, firebasePhoneConfig, verifyFirebaseGoogleToken, verifyFirebasePhoneToken } from "@/server/auth/firebase-phone";
import { firebaseGoogleConfig, rememberPendingLink } from "@/server/auth/google";
import { createSession } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { referralFromCookie } from "@/server/franchise/referral";
import { apiError, parseJson } from "@/server/http";
import { hmacSha256Hex, safeEqual } from "@/server/security/crypto";
import { clientIp, rateLimit } from "@/server/security/rate-limit";

/**
 * Login with Mobile OTP.
 *  verify: Firebase ID token → an existing customer with that mobile is signed in; a new number gets a 15-minute signed
 *          ticket (httpOnly cookie) to finish sign-up.
 *  signup: name + email + terms with that ticket → new account, mobile verified, signed in.
 * Continue with Google (through Firebase, used when the site's direct Google sign-in has no keys):
 *  google: Firebase ID token → same rules as /api/auth/google/callback: known Google id → signed in; email of an
 *          existing account → that customer logs in with their password once to link Google; new email → new account.
 */
const Body = z.discriminatedUnion("op", [
  z.object({ op: z.literal("verify"), idToken: z.string().min(20).max(4096), next: z.string().max(300).default("") }),
  z.object({ op: z.literal("google"), idToken: z.string().min(20).max(4096), next: z.string().max(300).default("") }),
  z.object({
    op: z.literal("signup"),
    name: z.string().trim().min(2, "Enter your full name").max(80),
    email: z.string().trim().toLowerCase().max(160).email("Enter a valid email address"),
    terms: z.literal(true, { errorMap: () => ({ message: "Please accept the Terms & shipping policy" }) }),
    next: z.string().max(300).default(""),
  }),
]);

const TICKET = "vs_phone";
const KEY = () => process.env.APP_ENCRYPTION_KEY ?? "dev";
const sign = (mobile: string, exp: number) => `${mobile}.${exp}.${hmacSha256Hex(KEY(), `phone-signup:${mobile}:${exp}`)}`;
function readTicket(v: string | undefined) {
  const [mobile, exp, mac] = (v ?? "").split(".");
  if (!mobile || !exp || !mac || Number(exp) < Date.now() || !safeEqual(mac, hmacSha256Hex(KEY(), `phone-signup:${mobile}:${exp}`))) return null;
  return mobile;
}
const safeNext = (n: string) => (n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/\\") ? n : "/portal/");
const cookieOpts = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict" as const, path: "/api/auth/firebase-phone" };

export async function POST(req: Request) {
  const ip = clientIp(req), ua = req.headers.get("user-agent") ?? "";
  if (!(await rateLimit(`phone-login:${ip}`, 20, 600)).ok) return apiError(429, "rate_limited", "Too many attempts. Please wait a few minutes and try again.");
  const p = await parseJson(req, Body); if (!p.ok) return p.res;
  const b = p.data;
  if (b.op === "google") return googleLogin(b.idToken, b.next, { ip, ua });
  const cfg = await firebasePhoneConfig();
  if (!cfg) return apiError(503, "provider_error", "Login with mobile OTP is switched off right now. Use email instead.");
  const db = await getDb();
  const jar = await cookies();

  if (b.op === "verify") {
    let mobile: string;
    try { ({ mobile } = await verifyFirebasePhoneToken(b.idToken, cfg.projectId)); }
    catch (e) {
      if (e instanceof PhoneTokenError) return apiError(401, "unauthorized", "The OTP check could not be confirmed. Please request a new OTP.");
      console.error("[phone-login]", (e as Error).message);
      return apiError(502, "provider_error", "Could not reach Google to confirm the OTP. Please try again.");
    }
    if (!(await rateLimit(`phone-login:m:${mobile}`, 10, 900)).ok) return apiError(429, "rate_limited", "Too many attempts for this number. Please wait a few minutes.");
    const [u] = await db.select().from(schema.users).where(and(eq(schema.users.kind, "customer"), eq(schema.users.mobile, mobile)));
    if (u) {
      if (!u.active) return apiError(403, "forbidden", "This account is not active. Contact support.");
      if (!u.mobileVerifiedAt) await db.update(schema.users).set({ mobileVerifiedAt: new Date() }).where(eq(schema.users.id, u.id));
      await createSession(u.id, "customer", { ip, ua });
      await audit({ actorUserId: u.id, actorKind: "customer", orgId: u.orgId, action: "auth.login", details: { via: "phone_otp" } });
      return NextResponse.json({ ok: true, redirect: safeNext(b.next) });
    }
    jar.set(TICKET, sign(mobile, Date.now() + 15 * 60_000), { ...cookieOpts, maxAge: 15 * 60 });
    return NextResponse.json({ ok: true, signup: true, mobile: `+91 ${mobile.slice(0, 5)} ${mobile.slice(5)}` });
  }

  // signup
  const mobile = readTicket(jar.get(TICKET)?.value);
  if (!mobile) return apiError(401, "unauthorized", "Your OTP session ended. Please verify your mobile number again.");
  if (!(await rateLimit(`signup:${ip}`, 5, 3600)).ok) return apiError(429, "rate_limited", "Too many sign-ups from this network. Please try again later.");
  const [byMobile] = await db.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.kind, "customer"), eq(schema.users.mobile, mobile)));
  if (byMobile) return apiError(409, "conflict", "This mobile number already has an account. Please log in with OTP again.");
  const [byEmail] = await db.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.kind, "customer"), eq(schema.users.email, b.email)));
  if (byEmail) return apiError(409, "conflict", "An account with this email already exists. Log in with your email, then add this mobile number in your profile.");
  const userId = await createCustomerAccount({ name: b.name, email: b.email, mobile, emailVerified: false, via: "phone_otp", referralCode: await referralFromCookie() });
  if (!userId) return apiError(409, "conflict", "An account with this email or mobile already exists. Please log in.");
  jar.delete({ name: TICKET, path: cookieOpts.path });
  await createSession(userId, "customer", { ip, ua });
  return NextResponse.json({ ok: true, redirect: "/portal/" });
}

async function googleLogin(idToken: string, next: string, meta: { ip: string; ua: string }) {
  const cfg = await firebaseGoogleConfig();
  if (!cfg) return apiError(503, "provider_error", "Continue with Google is switched off right now. Use email instead.");
  let id: { sub: string; email: string; name: string };
  try { id = await verifyFirebaseGoogleToken(idToken, cfg.projectId); }
  catch (e) {
    if (e instanceof PhoneTokenError) return apiError(401, "unauthorized", "Google sign-in could not be confirmed. Please try again.");
    console.error("[google-login]", (e as Error).message);
    return apiError(502, "provider_error", "Could not reach Google to confirm the sign-in. Please try again.");
  }
  if (!(await rateLimit(`google-login:s:${id.sub}`, 10, 900)).ok) return apiError(429, "rate_limited", "Too many attempts for this Google account. Please wait a few minutes.");
  const db = await getDb();
  const [bySub] = await db.select().from(schema.users).where(and(eq(schema.users.kind, "customer"), eq(schema.users.googleSub, id.sub)));
  if (bySub) {
    if (!bySub.active) return apiError(403, "forbidden", "This account is not active. Contact support.");
    await createSession(bySub.id, "customer", meta);
    await audit({ actorUserId: bySub.id, actorKind: "customer", orgId: bySub.orgId, action: "auth.login", details: { via: "google" } });
    return NextResponse.json({ ok: true, redirect: safeNext(next) });
  }
  const [byEmail] = await db.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.kind, "customer"), eq(schema.users.email, id.email)));
  if (byEmail) {
    // never sign in on email alone: the owner of the account confirms the link with their password once
    await rememberPendingLink({ sub: id.sub, email: id.email, name: id.name });
    const q = new URLSearchParams({ link: "google", email: id.email, ...(next ? { next } : {}) });
    return NextResponse.json({ ok: true, link: true, redirect: `/login/?${q}` });
  }
  const userId = await createCustomerAccount({ name: id.name, email: id.email, googleSub: id.sub, via: "google", referralCode: await referralFromCookie() });
  if (!userId) return apiError(409, "conflict", "An account with this email already exists. Please log in with your email and password.");
  await createSession(userId, "customer", meta);
  return NextResponse.json({ ok: true, redirect: "/portal/" });
}

/** Public web config (these values are public by design) so OTP screens know whether mobile OTP is ON. */
export async function GET() {
  return NextResponse.json({ config: await firebasePhoneConfig() }, { headers: { "cache-control": "no-store" } });
}
