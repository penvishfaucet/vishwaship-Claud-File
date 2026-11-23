import "server-only";
import { and, eq, gt, isNull } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb, schema } from "@/server/db/client";
import { sha256 } from "@/server/security/crypto";
import { randomToken } from "@/server/util/ids";
import { type Permission, type StaffRole, MFA_REQUIRED, can } from "./rbac";

const COOKIE = { customer: "vs_cs", staff: "vs_ss", franchise: "vs_fs" } as const;
const TTL = { customer: 14 * 86400_000, staff: 12 * 3600_000, franchise: 7 * 86400_000 };

export type Kind = "customer" | "staff" | "franchise";

export interface SessionUser {
  sessionId: string;
  userId: string;
  kind: Kind;
  name: string;
  email: string | null;
  orgId: string | null;
  role: StaffRole | null;
  mfaPassed: boolean;
  mustResetPassword: boolean;
  /** Set when an admin is viewing this customer account via "Login as customer". */
  impersonatorId: string | null;
}

export async function createSession(userId: string, kind: Kind, meta: { ip?: string; ua?: string; mfaPassed?: boolean; impersonatorId?: string; ttlMs?: number }) {
  const token = randomToken();
  const db = await getDb();
  const expiresAt = new Date(Date.now() + (meta.ttlMs ?? TTL[kind]));
  await db.insert(schema.sessions).values({ id: sha256(token), userId, expiresAt, ip: meta.ip, userAgent: meta.ua?.slice(0, 200), mfaPassed: !!meta.mfaPassed, impersonatorId: meta.impersonatorId ?? null });
  (await cookies()).set(COOKIE[kind], token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires: expiresAt,
  });
}

/** Mobile app tokens carry this prefix and arrive as `Authorization: Bearer vsm_…` (customer sessions only). */
export const MOBILE_TOKEN_PREFIX = "vsm_";

/** The customer token from the Android app's Authorization header, if any. Never accepted for staff. */
async function bearerToken(kind: Kind): Promise<string | null> {
  if (kind !== "customer") return null;
  const h = (await headers()).get("authorization") ?? "";
  const m = /^Bearer\s+(vsm_[A-Za-z0-9_-]{20,200})$/.exec(h.trim());
  return m ? m[1] : null;
}

export async function readSession(kind: Kind): Promise<SessionUser | null> {
  // Browser: the httpOnly cookie. Android app: a bearer token stored in the same sessions table (same user, same rules).
  const token = (await cookies()).get(COOKIE[kind])?.value ?? (await bearerToken(kind));
  if (!token) return null;
  const db = await getDb();
  const [row] = await db.select({ s: schema.sessions, u: schema.users }).from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.id, sha256(token)), isNull(schema.sessions.revokedAt), gt(schema.sessions.expiresAt, new Date())));
  if (!row || !row.u.active || row.u.kind !== kind) return null;
  return {
    sessionId: row.s.id, userId: row.u.id, kind, name: row.u.name, email: row.u.email, orgId: row.u.orgId,
    role: row.u.staffRole, mfaPassed: row.s.mfaPassed, mustResetPassword: row.u.mustResetPassword, impersonatorId: row.s.impersonatorId ?? null,
  };
}

export async function destroySession(kind: Kind) {
  const jar = await cookies();
  const token = jar.get(COOKIE[kind])?.value;
  if (token) {
    const db = await getDb();
    await db.update(schema.sessions).set({ revokedAt: new Date() }).where(eq(schema.sessions.id, sha256(token)));
  }
  jar.delete(COOKIE[kind]);
}

export async function revokeAllSessions(userId: string) {
  const db = await getDb();
  await db.update(schema.sessions).set({ revokedAt: new Date() }).where(and(eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt)));
}

/** Pages: customer area. Redirects to /login/ when not signed in. */
export async function requireCustomer(): Promise<SessionUser & { orgId: string }> {
  const s = await readSession("customer");
  if (!s || !s.orgId) redirect("/login/");
  return s as SessionUser & { orgId: string };
}

function mfaOk(s: SessionUser) {
  // Demo staff skip MFA only when explicitly allowed for local development — never in production, even if the flag is set.
  if (process.env.NODE_ENV !== "production" && process.env.ALLOW_DEMO_STAFF_WITHOUT_MFA === "1" && s.email?.endsWith("@demo.vishwaship.test")) return true;
  return !MFA_REQUIRED.includes(s.role!) || s.mfaPassed;
}

/** Pages: admin area, optionally gated on a permission. */
export async function requireStaff(perm?: Permission): Promise<SessionUser & { role: StaffRole }> {
  const s = await readSession("staff");
  if (!s || !s.role) redirect("/admin/login/");
  if (!mfaOk(s)) redirect("/admin/mfa/");
  if (perm && !can(s.role, perm)) redirect("/admin/?denied=" + encodeURIComponent(perm));
  return s as SessionUser & { role: StaffRole };
}

/** APIs: same checks but return null instead of redirecting. */
export async function apiStaff(perm?: Permission) {
  const s = await readSession("staff");
  if (!s || !s.role || !mfaOk(s)) return null;
  if (perm && !can(s.role, perm)) return null;
  return s as SessionUser & { role: StaffRole };
}
export async function apiCustomer() {
  const s = await readSession("customer");
  return s?.orgId ? (s as SessionUser & { orgId: string }) : null;
}
