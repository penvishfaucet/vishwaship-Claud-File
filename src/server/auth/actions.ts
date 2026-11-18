"use server";
import { and, eq, or } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getDb, schema } from "@/server/db/client";
import { audit } from "@/server/audit";
import { hashPassword, verifyPassword } from "@/server/security/crypto";
import { rateLimit } from "@/server/security/rate-limit";
import { newId } from "@/server/util/ids";
import { createSession, destroySession, readSession, revokeAllSessions } from "./session";

export type FormState = { error?: string; ok?: string } | undefined;

async function meta() {
  const h = await headers();
  return { ip: (h.get("x-forwarded-for")?.split(",")[0] ?? "local").trim(), ua: h.get("user-agent") ?? "" };
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
  redirect(safeNext(fd.get("next"), "/portal/"));
}

const SignupSchema = z.object({
  name: z.string().trim().min(2).max(80),
  business: z.string().trim().min(2, "Business name is required").max(120),
  mobile: z.string().transform(normalizeMobile).pipe(z.string().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit Indian mobile number")),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, "Password must be at least 8 characters").max(128),
  volume: z.string().max(20),
  gstin: z.string().trim().toUpperCase().regex(/^$|^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, "GSTIN format is invalid").optional(),
  terms: z.literal("on", { errorMap: () => ({ message: "Please accept the Terms & shipping policy" }) }),
});

export async function customerSignup(_: FormState, fd: FormData): Promise<FormState> {
  const m = await meta();
  const rl = await rateLimit(`signup:${m.ip}`, 5, 3600);
  if (!rl.ok) return { error: "Too many sign-ups from this network. Please try again later." };
  const p = SignupSchema.safeParse(Object.fromEntries(fd));
  if (!p.success) return { error: p.error.issues[0].message };
  const v = p.data;
  const db = await getDb();
  const dup = await db.select({ id: schema.users.id }).from(schema.users)
    .where(and(eq(schema.users.kind, "customer"), or(eq(schema.users.email, v.email), eq(schema.users.mobile, v.mobile))));
  if (dup.length) return { error: "An account with this email or mobile already exists. Try logging in." };
  const orgId = newId("org"), userId = newId("usr");
  await db.insert(schema.orgs).values({ id: orgId, name: v.business, businessName: v.business, gstin: v.gstin || null, expectedMonthlyVolume: v.volume });
  await db.insert(schema.users).values({ id: userId, kind: "customer", orgId, name: v.name, email: v.email, mobile: v.mobile, passwordHash: await hashPassword(v.password) });
  await db.insert(schema.wallets).values({ id: newId("wal"), orgId });
  await db.insert(schema.creditBalances).values({ orgId, credits: 0 });
  await audit({ actorUserId: userId, actorKind: "customer", orgId, action: "auth.signup" });
  // Email/mobile verification is sent by the notification worker once a provider is configured.
  await createSession(userId, "customer", m);
  redirect(safeNext(fd.get("next"), "/portal/?welcome=1"));
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
