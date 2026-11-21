import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db/client";
import { applyDefaultPrice } from "./commission";

/**
 * Franchise referral: the link /r/<CODE>/ remembers the code in a cookie for 30 days and opens Sign up. When the new
 * account is created (web, Google or the Android app, which sends the code in the body), the customer is linked to
 * that franchise — only if the franchise is active, and never replacing an existing link.
 */
export const REF_COOKIE = "vs_ref";
export const REF_DAYS = 30;
export const normalizeCode = (raw: string | null | undefined) => {
  const c = String(raw ?? "").trim().toUpperCase();
  return /^VSF-\d{4,6}$/.test(c) ? c : null;
};

export async function activeFranchiseByCode(raw: string | null | undefined) {
  const code = normalizeCode(raw);
  if (!code) return null;
  const db = await getDb();
  const [f] = await db.select({ id: schema.franchises.id, code: schema.franchises.code, businessName: schema.franchises.businessName })
    .from(schema.franchises).where(and(eq(schema.franchises.code, code), eq(schema.franchises.status, "active")));
  return f ?? null;
}

/** The referral code remembered in this browser, if any (null outside a request). */
export async function referralFromCookie() {
  try { return normalizeCode((await cookies()).get(REF_COOKIE)?.value); } catch { return null; }
}

/** Link a just-created customer org to the referring franchise. Never throws: sign-up must not fail because of it. */
export async function attributeReferral(orgId: string, rawCode: string | null | undefined) {
  try {
    const f = await activeFranchiseByCode(rawCode);
    if (!f) return null;
    const db = await getDb();
    const res = await db.update(schema.orgs).set({ franchiseId: f.id, franchiseLinkedAt: new Date(), franchiseLinkSource: "referral" })
      .where(and(eq(schema.orgs.id, orgId), isNull(schema.orgs.franchiseId))).returning({ id: schema.orgs.id });
    if (!res.length) return null;
    await audit({ actorKind: "system", orgId, action: "franchise.customer_referred", targetType: "franchise", targetId: f.id, details: { code: f.code } });
    await applyDefaultPrice(orgId, f.id);
    return f.id;
  } catch {
    return null;
  }
}

/** Site address for links shown on screen: APP_URL, else (local dev only) the address this page was opened on. */
export async function siteBase() {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, "");
  if (process.env.NODE_ENV === "production") return "https://vishwaship.in";
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") ?? h.get("host");
    if (host && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host)) return `http://${host}`;
  } catch { /* outside a request */ }
  return "http://localhost:3000";
}
export const referralLink = (base: string, code: string) => `${base}/r/${code}/`;
