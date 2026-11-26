import "server-only";
import { and, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/server/db/client";
import { sha256, verifyPassword } from "@/server/security/crypto";
import { randomToken } from "@/server/util/ids";
import { newId } from "@/server/util/ids";
import { MOBILE_TOKEN_PREFIX } from "@/server/auth/session";
import { ipFromHeaders } from "@/server/security/rate-limit";

/**
 * Android app sessions. They live in the same `sessions` table as browser sessions (same user, same org,
 * same revocation — "Log out of all devices" and password reset sign the app out too). The token is
 * returned once in JSON and sent back as `Authorization: Bearer vsm_…`; only its sha256 is stored.
 */
export const MOBILE_TTL_MS = 30 * 86400_000;
/** A token older than this is rotated on /auth/refresh (keeps active users signed in, expires idle ones). */
export const MOBILE_REFRESH_AFTER_MS = 24 * 3600_000;

export type DeviceInfo = { installId: string; appVersion?: string };
/** Device block sent with sign-in / signup / reset: a random per-install id generated on the phone. */
export const DeviceSchema = z.object({ installId: z.string().regex(/^[\w-]{16,64}$/), appVersion: z.string().max(40).optional() });

const normalizeMobile = (s: string) => {
  const d = s.replace(/\D/g, "");
  return d.length === 12 && d.startsWith("91") ? d.slice(2) : d;
};

/** Same identifier rules as the website login: email, or a 10-digit mobile (with or without +91). */
export async function findCustomerByIdentifier(identifier: string) {
  const id = identifier.trim().toLowerCase();
  const db = await getDb();
  const mobile = normalizeMobile(id);
  const [u] = await db.select().from(schema.users).where(and(eq(schema.users.kind, "customer"),
    or(eq(schema.users.email, id), mobile.length === 10 ? eq(schema.users.mobile, mobile) : eq(schema.users.email, id))));
  return u ?? null;
}

export async function checkCustomerPassword(identifier: string, password: string) {
  const u = await findCustomerByIdentifier(identifier);
  const ok = await verifyPassword(password, u?.passwordHash);
  if (!u || !ok || !u.active || !u.orgId) return null;
  return u;
}

/**
 * Issue an app session and bind this install to it. Re-using an install for another account re-assigns the
 * device row and clears its push token, so the previous account's alerts can never reach it.
 */
export async function issueMobileSession(userId: string, orgId: string, meta: { ip?: string; ua?: string }, device?: DeviceInfo) {
  const token = MOBILE_TOKEN_PREFIX + randomToken();
  const sessionId = sha256(token);
  const expiresAt = new Date(Date.now() + MOBILE_TTL_MS);
  const db = await getDb();
  await db.insert(schema.sessions).values({ id: sessionId, userId, expiresAt, ip: meta.ip, userAgent: `android-app ${meta.ua ?? ""}`.slice(0, 200), mfaPassed: false });
  if (device?.installId) await bindDevice(device, { userId, orgId, sessionId });
  return { token, expiresAt: expiresAt.toISOString(), refreshAfter: new Date(Date.now() + MOBILE_REFRESH_AFTER_MS).toISOString() };
}

async function bindDevice(device: DeviceInfo, a: { userId: string; orgId: string; sessionId: string }) {
  const db = await getDb();
  const [row] = await db.select().from(schema.mobileDevices).where(eq(schema.mobileDevices.installId, device.installId));
  if (!row) {
    await db.insert(schema.mobileDevices).values({ id: newId("dev"), installId: device.installId, appVersion: device.appVersion?.slice(0, 40), ...a });
    return;
  }
  const sameUser = row.userId === a.userId;
  await db.update(schema.mobileDevices).set({
    ...a, appVersion: device.appVersion?.slice(0, 40) ?? row.appVersion, revokedAt: null, lastSeenAt: new Date(),
    // another account on this install: forget the old push registration until the app registers again
    ...(sameUser ? {} : { pushToken: null, pushEnabled: false }),
  }).where(eq(schema.mobileDevices.id, row.id));
}

/** Rotate a still-valid app token: the old one is revoked, the device follows the new session. */
export async function rotateMobileSession(oldSessionId: string, userId: string, orgId: string, meta: { ip?: string; ua?: string }) {
  const db = await getDb();
  const [dev] = await db.select().from(schema.mobileDevices).where(and(eq(schema.mobileDevices.sessionId, oldSessionId), isNull(schema.mobileDevices.revokedAt)));
  const next = await issueMobileSession(userId, orgId, meta);
  await db.update(schema.sessions).set({ revokedAt: new Date() }).where(eq(schema.sessions.id, oldSessionId));
  if (dev) await db.update(schema.mobileDevices).set({ sessionId: sha256(next.token), lastSeenAt: new Date() }).where(eq(schema.mobileDevices.id, dev.id));
  return next;
}

/** Logout: revoke the session and detach the device from push (no alerts after sign-out). */
export async function revokeMobileSession(sessionId: string) {
  const db = await getDb();
  await db.update(schema.sessions).set({ revokedAt: new Date() }).where(eq(schema.sessions.id, sessionId));
  await db.update(schema.mobileDevices).set({ revokedAt: new Date(), pushToken: null, pushEnabled: false }).where(eq(schema.mobileDevices.sessionId, sessionId));
}

/** True when the request is authenticated with an app token (not the browser cookie). */
export function isMobileRequest(req: Request) {
  return /^Bearer\s+vsm_/.test(req.headers.get("authorization") ?? "");
}

export function requestMeta(req: Request) {
  return { ip: ipFromHeaders(req.headers), ua: req.headers.get("user-agent") ?? "" };
}
