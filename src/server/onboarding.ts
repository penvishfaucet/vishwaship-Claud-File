import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";

export type OnboardingStep = "profile" | "kyc" | "review" | "resubmit" | "active";
export const STEP_TEXT: Record<OnboardingStep, { title: string; action?: { label: string; href: string } }> = {
  profile: { title: "Complete Your Profile", action: { label: "Complete Your Profile", href: "/portal/onboarding/" } },
  kyc: { title: "Complete KYC", action: { label: "Complete KYC", href: "/portal/kyc/" } },
  review: { title: "KYC Under Review" },
  resubmit: { title: "KYC needs changes", action: { label: "Resubmit KYC", href: "/portal/kyc/" } },
  active: { title: "Account Active" },
};

/**
 * Where a customer is in onboarding. The account is Active only when the profile is complete AND Admin approved KYC.
 * Used by the portal (what to show / where to send) and by booking (server-side gate).
 */
export async function onboardingState(orgId: string): Promise<{ step: OnboardingStep; reasons: string[] }> {
  const db = await getDb();
  const [o] = await db.select({ profile: schema.orgs.profileCompletedAt, kyc: schema.orgs.kycStatus }).from(schema.orgs).where(eq(schema.orgs.id, orgId));
  if (!o) return { step: "profile", reasons: [] };
  if (!o.profile) return { step: "profile", reasons: [] };
  if (o.kyc === "approved") return { step: "active", reasons: [] };
  if (o.kyc === "pending") return { step: "review", reasons: [] };
  if (o.kyc === "changes_requested" || o.kyc === "rejected") {
    const docs = await db.select({ t: schema.kycDocuments.docType, r: schema.kycDocuments.reviewReason }).from(schema.kycDocuments)
      .where(and(eq(schema.kycDocuments.orgId, orgId), inArray(schema.kycDocuments.status, ["changes_requested", "rejected"]))).orderBy(desc(schema.kycDocuments.reviewedAt));
    return { step: "resubmit", reasons: docs.filter((d) => d.r).map((d) => `${d.t.replace(/_/g, " ")}: ${d.r}`) };
  }
  return { step: "kyc", reasons: [] };
}

export const ACTIVATION_MESSAGE: Record<Exclude<OnboardingStep, "active">, string> = {
  profile: "Complete your profile (business name and address) before booking shipments. KYC is optional — approve it for the best rates.",
  kyc: "Complete KYC for the best rates. You can book shipments meanwhile at standard rates.",
  review: "Your KYC is under review. The best rates apply as soon as it is approved.",
  resubmit: "Your KYC needs changes. Resubmit it to get the best rates.",
};
