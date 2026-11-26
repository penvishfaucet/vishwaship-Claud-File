"use server";
import { and, eq, or } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb, schema } from "@/server/db/client";
import { audit } from "@/server/audit";
import { hashPassword, verifyPassword } from "@/server/security/crypto";
import { rateLimit, ipFromHeaders } from "@/server/security/rate-limit";
import { newId } from "@/server/util/ids";
import { createSession, destroySession, readSession, revokeAllSessions } from "./session";
import { consumeResetOtp, consumeSignupOtp } from "./signup-otp";
import { linkPendingGoogle } from "./google";
import { createCustomerAccount } from "./accounts";
import { referralFromCookie } from "@/server/franchise/referral";

export type FormState = { error?: string; ok?: string } | undefined;

async function meta() {
  const h = await headers();
  return { ip: ipFromHeaders(h), ua: h.get("user-agent") ?? "" };
}

const normalizeMobile = (s: string) => {
  const d = s.replace(/\D/g, "");
  return d.length === 12 && d.startsWith("91") ? d.slice(2) : d;
};

function safeNext(n: FormDataEntryValue | null, fallback: string) {
  const s = typeof n === "string" ? n : "";
  return s.startsWith("/") && !s.startsWith("//") ? s : fallback;
}

export async function customerLogin(_: FormState, fd: FormData): Promise<FormState> {
  const id = String(fd.get("identifier") ?? "").trim().toLowerCase();
  const password = String(fd.get("password") ?? "");
  const m = await meta();
  const rl = await rateLimit(`login:c:${m.ip}`, 10, 600);
  const rlId = await rateLimit(`login:c:id:${id}`, 8, 900);
  if (!rl.ok || !rlId.ok) return { error: "Too many attempts. Please wait a few minutes and try again." };
  const db = await getDb();
  const mobile = normalizeMobile(id);
  const [u] = await db.select().from(schema.users).where(and(eq(schema.users.kind, "customer"),
    or(eq(schema.users.email, id), mobile.length === 10 ? eq(schema.users.mobile, mobile) : eq(schema.users.email, id))));
  const ok = await verifyPassword(password, u?.passwordHash);
  if (!u || !ok || !u.active) return { error: "Incorrect email/mobile or password." };
  await createSession(u.id, "customer", m);
  await audit({ actorUserId: u.id, actorKind: "customer", orgId: u.orgId, action: "auth.login" });
  const linked = await linkPendingGoogle(u.id, u.email);
  if (linked) redirect("/portal/?google=linked");
  redirect(safeNext(fd.get("next"), "/portal/"));
}

const SignupSchema = z.object({
  name: z.string().trim().min(2, "Enter your full name").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  otp: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code sent to your email"),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
  confirm: z.string(),
  terms: z.literal("on", { errorMap: () => ({ message: "Please accept the Terms & shipping policy" }) }),
});

export async function customerSignup(_: FormState, fd: FormData): Promise<FormState> {
  const m = await meta();
  const rl = await rateLimit(`signup:${m.ip}`, 5, 3600);
  if (!rl.ok) return { error: "Too many sign-ups from this network. Please try again later." };
  const p = SignupSchema.safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: p.error.issues[0].message };
  const v = p.data;
  if (v.password !== v.confirm) return { error: "Create password and Confirm password do not match" };
  const db = await getDb();
  const dup = await db.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.kind, "customer"), eq(schema.users.email, v.email)));
  if (dup.length) return { error: "An account with this email already exists. Log in, or use Forgot password to recover it." };
  // The account exists only after the email code is verified (single use, expiry and attempts checked on the server).
  const otp = await consumeSignupOtp(v.email, v.otp);
  if (!otp.ok) return { error: otp.message };
  const userId = await createCustomerAccount({ name: v.name, email: v.email, passwordHash: await hashPassword(v.password), via: "email_otp", referralCode: await referralFromCookie() });
  if (!userId) return { error: "An account with this email already exists. Log in, or use Forgot password to recover it." };
  await createSession(userId, "customer", m);
  redirect("/portal/");
}

const ResetSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  otp: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code sent to your email"),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
  confirm: z.string(),
});

/** Forgot password: the emailed code proves the email; the new password replaces the old one and every other session is signed out. */
export async function customerResetPassword(_: FormState, fd: FormData): Promise<FormState> {
  const m = await meta();
  if (!(await rateLimit(`reset:${m.ip}`, 10, 3600)).ok) return { error: "Too many attempts. Please try again later." };
  const p = ResetSchema.safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: p.error.issues[0].message };
  const v = p.data;
  if (v.password !== v.confirm) return { error: "New password and Confirm password do not match" };
  const db = await getDb();
  const [u] = await db.select().from(schema.users).where(and(eq(schema.users.kind, "customer"), eq(schema.users.email, v.email)));
  if (!u || !u.active) return { error: "No Vishwaship account uses this email." };
  const otp = await consumeResetOtp(v.email, v.otp);
  if (!otp.ok) return { error: otp.message };
  await db.update(schema.users).set({ passwordHash: await hashPassword(v.password), emailVerifiedAt: u.emailVerifiedAt ?? new Date() }).where(eq(schema.users.id, u.id));
  await revokeAllSessions(u.id);
  await audit({ actorUserId: u.id, actorKind: "customer", orgId: u.orgId, action: "auth.password_reset", details: { via: "email_otp" } });
  await createSession(u.id, "customer", m);
  redirect("/portal/?password=changed");
}

export async function customerLogout() {
  await destroySession("customer");
  redirect("/login/");
}

export async function customerLogoutAll() {
  const s = await readSession("customer");
  if (s?.impersonatorId) { await destroySession("customer"); redirect(`/admin/customers/${s.orgId}/`); }
  if (s) { await revokeAllSessions(s.userId); await audit({ actorUserId: s.userId, actorKind: "customer", orgId: s.orgId, action: "auth.logout_all" }); }
  await destroySession("customer");
  redirect("/login/");
}

export async function staffLogin(_: FormState, fd: FormData): Promise<FormState> {
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const password = String(fd.get("password") ?? "");
  const m = await meta();
  const rl = await rateLimit(`login:s:${m.ip}`, 8, 900);
  const rlId = await rateLimit(`login:s:id:${email}`, 5, 900);
  if (!rl.ok || !rlId.ok) return { error: "Too many attempts. Please wait 15 minutes." };
  const db = await getDb();
  const [u] = await db.select().from(schema.users).where(and(eq(schema.users.kind, "staff"), eq(schema.users.email, email)));
  const ok = await verifyPassword(password, u?.passwordHash);
  if (!u || !ok || !u.active) {
    await audit({ actorKind: "system", action: "auth.staff_login_failed", details: { email } });
    return { error: "Incorrect email or password." };
  }
  await createSession(u.id, "staff", m);
  await audit({ actorUserId: u.id, actorKind: "staff", action: "auth.staff_login" });
  redirect(u.mustResetPassword ? "/admin/setup-password/" : "/admin/");
}

export async function staffLogout() {
  await destroySession("staff");
  redirect("/admin/login/");
}
