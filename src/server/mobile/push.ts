import "server-only";
import { createSign } from "node:crypto";
import { and, eq, gt, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { safeFetch } from "@/server/security/safe-fetch";

/**
 * Android push for in-app alerts. Every place that already writes an in_app_alerts row (tracking, wallet,
 * KYC, tickets, COD remittance, invoices, reports) gets a push automatically: the sweep claims new alerts
 * once (pushed_at), then sends to the org's signed-in devices whose session is still valid.
 *
 * Lock-screen safety: the push carries only a generic title per kind and an opaque deep link. The alert text
 * (amounts, AWBs, reasons) is shown only inside the app after sign-in, from /api/mobile/v1/alerts.
 *
 * Configuration: FCM_SERVICE_ACCOUNT_B64 (base64 of the Firebase service-account JSON) on the server.
 * Without it, alerts are still claimed (so enabling push later never floods old alerts) and the inbox works.
 */
const FCM_HOSTS = ["oauth2.googleapis.com", "fcm.googleapis.com"];
/** Only alerts this recent are pushed; older ones stay in the inbox. */
const MAX_AGE_MS = 60 * 60_000;

export const PUSH_COPY: Record<string, { title: string; channel: string }> = {
  tracking: { title: "Shipment update", channel: "shipments" },
  wallet: { title: "Wallet update", channel: "wallet" },
  cod: { title: "COD remittance update", channel: "wallet" },
  billing: { title: "New billing document", channel: "wallet" },
  ticket: { title: "Support ticket update", channel: "support" },
  kyc: { title: "KYC update", channel: "account" },
  report: { title: "Your report is ready", channel: "account" },
};

/** Portal link → app deep link path (opaque ids only). Unknown links open the inbox. */
export function appLinkFor(href: string | null): string {
  if (!href) return "/alerts";
  const m = /^\/portal\/orders\/([\w-]+)\/?$/.exec(href);
  if (m) return `/orders/${m[1]}`;
  const t = /^\/portal\/support\/([\w-]+)\/?$/.exec(href);
  if (t) return `/support/${t[1]}`;
  if (href.startsWith("/portal/billing")) return "/wallet";
  if (href.startsWith("/portal/kyc")) return "/kyc";
  return "/alerts";
}

type ServiceAccount = { project_id: string; client_email: string; private_key: string };
function serviceAccount(): ServiceAccount | null {
  const b64 = process.env.FCM_SERVICE_ACCOUNT_B64;
  if (!b64) return null;
  try {
    const sa = JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as ServiceAccount;
    return sa.project_id && sa.client_email && sa.private_key ? sa : null;
  } catch { return null; }
}
export const pushConfigured = () => serviceAccount() !== null;

let cached: { token: string; exp: number } | null = null;
async function accessToken(sa: ServiceAccount) {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const b64u = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const unsigned = `${b64u({ alg: "RS256", typ: "JWT" })}.${b64u({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
  const sig = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key).toString("base64url");
  const res = await safeFetch("https://oauth2.googleapis.com/token", {
    method: "POST", allowedHosts: FCM_HOSTS, headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${sig}` }).toString(),
  });
  if (!res.ok) throw new Error(`FCM auth failed (${res.status})`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return cached.token;
}

async function sendOne(sa: ServiceAccount, token: string, msg: { alertId: string; kind: string; link: string }) {
  const copy = PUSH_COPY[msg.kind] ?? { title: "Vishwaship update", channel: "account" };
  const res = await safeFetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id)}/messages:send`, {
    method: "POST", allowedHosts: FCM_HOSTS,
    headers: { authorization: `Bearer ${await accessToken(sa)}`, "content-type": "application/json" },
    body: JSON.stringify({ message: {
      token,
      // data-only: the app builds a private notification (VISIBILITY_PRIVATE) on the right channel
      data: { alertId: msg.alertId, kind: msg.kind, title: copy.title, channel: copy.channel, link: msg.link },
      android: { priority: "high", collapse_key: msg.alertId },
    } }),
  });
  if (res.status === 404 || res.status === 400) return "invalid" as const; // unregistered / stale token
  if (!res.ok) throw new Error(`FCM send failed (${res.status})`);
  return "sent" as const;
}

/** Claim new alerts once and push them. Safe to run from several workers (claim is an atomic UPDATE). */
export async function dispatchPush(limit = 200) {
  const db = await getDb();
  const claimed = await db.update(schema.inAppAlerts).set({ pushedAt: new Date() })
    .where(and(isNull(schema.inAppAlerts.pushedAt), inArray(schema.inAppAlerts.id,
      db.select({ id: schema.inAppAlerts.id }).from(schema.inAppAlerts)
        .where(and(isNull(schema.inAppAlerts.pushedAt), gt(schema.inAppAlerts.createdAt, new Date(Date.now() - MAX_AGE_MS)))).limit(limit))))
    .returning({ id: schema.inAppAlerts.id, orgId: schema.inAppAlerts.orgId, kind: schema.inAppAlerts.kind, href: schema.inAppAlerts.href });
  // older never-pushed alerts are simply marked, never pushed late
  await db.update(schema.inAppAlerts).set({ pushedAt: new Date() }).where(and(isNull(schema.inAppAlerts.pushedAt), sql`${schema.inAppAlerts.createdAt} <= ${new Date(Date.now() - MAX_AGE_MS)}`));
  const sa = serviceAccount();
  if (!sa || !claimed.length) return { claimed: claimed.length, sent: 0 };
  const orgIds = [...new Set(claimed.map((a) => a.orgId))];
  const devices = await db.select({ id: schema.mobileDevices.id, orgId: schema.mobileDevices.orgId, token: schema.mobileDevices.pushToken })
    .from(schema.mobileDevices)
    .innerJoin(schema.sessions, eq(schema.sessions.id, schema.mobileDevices.sessionId))
    .innerJoin(schema.users, eq(schema.users.id, schema.mobileDevices.userId))
    .where(and(inArray(schema.mobileDevices.orgId, orgIds), eq(schema.mobileDevices.pushEnabled, true), isNotNull(schema.mobileDevices.pushToken),
      isNull(schema.mobileDevices.revokedAt), isNull(schema.sessions.revokedAt), gt(schema.sessions.expiresAt, new Date()),
      eq(schema.users.active, true), sql`${schema.users.orgId} = ${schema.mobileDevices.orgId}`));
  let sent = 0;
  for (const a of claimed) {
    for (const d of devices.filter((x) => x.orgId === a.orgId)) {
      try {
        const r = await sendOne(sa, d.token!, { alertId: a.id, kind: a.kind, link: appLinkFor(a.href) });
        if (r === "invalid") await db.update(schema.mobileDevices).set({ pushToken: null, pushEnabled: false }).where(eq(schema.mobileDevices.id, d.id));
        else sent++;
      } catch (e) { console.error("[push]", (e as Error).message); }
    }
  }
  return { claimed: claimed.length, sent };
}
