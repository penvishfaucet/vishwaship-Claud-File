import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { audit } from "@/server/audit";
import { newId } from "@/server/util/ids";
import { attributeReferral } from "@/server/franchise/referral";
import { addActivity, createLead } from "@/server/crm/leads";

/**
 * New customer account (email-OTP signup, first Google sign-in, or mobile OTP signup). The email is verified by the caller,
 * except for mobile OTP signups (emailVerified: false), where the mobile number is the verified identity.
 * Email sign-ups also give mobile (not verified), business name and parcels per day; Google / mobile OTP sign-ups give
 * them on /welcome/. Returns null when the email (or mobile) is taken.
 */
export async function createCustomerAccount(a: {
  name: string; email: string; passwordHash?: string | null; googleSub?: string; via: "email_otp" | "google" | "phone_otp";
  referralCode?: string | null; mobile?: string; emailVerified?: boolean; mobileVerified?: boolean; businessName?: string; dailyParcels?: string;
}) {
  const db = await getDb();
  const orgId = newId("org"), userId = newId("usr");
  const mobileVerified = a.mobile ? a.mobileVerified ?? true : false;
  try {
    await db.insert(schema.orgs).values({ id: orgId, name: a.name, businessName: a.businessName?.trim() || a.name, dailyParcels: a.dailyParcels ?? null });
    await db.insert(schema.users).values({ id: userId, kind: "customer", orgId, name: a.name, email: a.email, emailVerifiedAt: a.emailVerified === false ? null : new Date(), mobile: a.mobile ?? null, mobileVerifiedAt: mobileVerified ? new Date() : null, passwordHash: a.passwordHash ?? null, googleSub: a.googleSub ?? null });
  } catch (e) {
    if (/unique|duplicate/i.test((e as Error).message) || (e as { cause?: { code?: string } }).cause?.code === "23505") { await db.delete(schema.orgs).where(eq(schema.orgs.id, orgId)); return null; }
    throw e;
  }
  await db.insert(schema.wallets).values({ id: newId("wal"), orgId });
  await db.insert(schema.creditBalances).values({ orgId, credits: 0 });
  await audit({ actorUserId: userId, actorKind: "customer", orgId, action: "auth.signup", details: { via: a.via } });
  // Franchise referral link (cookie on web / code from the app). Skipped silently when unknown or not active.
  if (a.referralCode) await attributeReferral(orgId, a.referralCode);
  if (a.mobile && a.dailyParcels) await signupLead(orgId, { name: a.name, mobile: a.mobile, email: a.email, business: a.businessName ?? a.name, dailyParcels: a.dailyParcels, via: a.via });
  return userId;
}

/** Is a customer mobile already used by another customer account? */
export async function customerMobileTaken(mobile: string, exceptUserId?: string) {
  const db = await getDb();
  const [u] = await db.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.kind, "customer"), eq(schema.users.mobile, mobile)));
  return !!u && u.id !== exceptUserId;
}

const VIA_TEXT = { email_otp: "email", google: "Google", phone_otp: "mobile OTP" } as const;

/**
 * Every new sign-up becomes a lead in Admin → CRM Leads (source Website, status New), linked to the account,
 * so the team calls back. Never blocks the sign-up.
 */
export async function signupLead(orgId: string, d: { name: string; mobile: string; email?: string | null; business: string; dailyParcels: string; via: keyof typeof VIA_TEXT }) {
  try {
    const r = await createLead({
      name: d.name, mobile: d.mobile, email: d.email ?? null, company: d.business, source: "website", campaign: "Website sign-up",
      volume: `Per day: ${d.dailyParcels}`,
      answers: [{ q: "Business name", a: d.business }, { q: "Parcels per day", a: d.dailyParcels }, { q: "Signed up with", a: VIA_TEXT[d.via] }],
    }, null);
    const db = await getDb();
    await db.update(schema.crmLeads).set({ orgId, updatedAt: new Date() }).where(eq(schema.crmLeads.id, r.id));
    await addActivity(r.id, "form", `Signed up on vishwaship.in (${VIA_TEXT[d.via]}) — ${d.business}, ${d.dailyParcels} per day. Call back to help them start shipping.`, null, { signup: true, orgId });
  } catch (e) {
    console.error("[signup-lead]", (e as Error).message);
  }
}
