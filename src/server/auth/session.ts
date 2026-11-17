import "server-only";
import { and, eq, gt, isNull } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb, schema } from "@/server/db/client";
import { sha256 } from "@/server/security/crypto";
import { randomToken } from "@/server/util/ids";
import { type Permission, type StaffRole, MFA_REQUIRED, can } from "./rbac";

const COOKIE = { customer: "vs_cs", staff: "vs_ss" } as const;
const TTL = { customer: 14 * 86400_000, staff: 12 * 3600_000 };

export type Kind = "customer" | "staff";

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
}

export async function createSession(userId: string, kind: Kind, meta: { ip?: string; ua?: string; mfaPassed?: boolean }) {
  const token = randomToken();
  const db = await getDb();
  const expiresAt = new Date(Date.now() + TTL[kind]);
  await db.insert(schema.sessions).values({ id: sha256(token), userId, expiresAt, ip: meta.ip, userAgent: meta.ua?.slice(0, 200), mfaPassed: !!meta.mfaPassed });
  (await cookies()).set(COOKIE[kind], token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires: expiresAt,
  });
}

export async function readSession(kind: Kind): Promise<SessionUser | null> {
  const token = (await cookies()).get(COOKIE[kind])?.value;
  if (!token) return null;
  const db = await getDb();
  const [row] = await db.select({ s: schema.sessions, u: schema.users }).from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.id, sha256(token)), isNull(schema.sessions.revokedAt), gt(schema.sessions.expiresAt, new Date())));
  if (!row || !row.u.active || row.u.kind !== kind) return null;
  return {
    sessionId: row.s.id, userId: row.u.id, kind, name: row.u.name, email: row.u.email, orgId: row.u.orgId,
    role: row.u.staffRole, mfaPassed: row.s.mfaPassed, mustResetPassword: row.u.mustResetPassword,
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
  // Demo staff skip MFA only when explicitly allowed for local development.
  if (process.env.ALLOW_DEMO_STAFF_WITHOUT_MFA === "1" && s.email?.endsWith("@demo.vishwaship.test")) return true;
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
