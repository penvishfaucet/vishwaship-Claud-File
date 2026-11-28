import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { WelcomeDetailsForm } from "@/components/auth/Forms";
import { readSession } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { needsSignupDetails } from "@/server/auth/signup-details";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your business details — Vishwaship", robots: { index: false } };

/** Mobile, name, business name and parcels per day — once, for Google / mobile-OTP sign-ups (see portal layout). */
export default async function WelcomePage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const s = await readSession("customer");
  if (!s) redirect("/login/");
  const db = await getDb();
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, s.userId));
  const [o] = u?.orgId ? await db.select().from(schema.orgs).where(eq(schema.orgs.id, u.orgId)) : [];
  if (!u || !o) redirect("/login/");
  if (!needsSignupDetails(u, o)) redirect("/portal/");
  const business = o.businessName && o.businessName !== o.name ? o.businessName : "";
  return (
    <AuthShell>
      <WelcomeDetailsForm next={next} mobileLocked={!!(u.mobile && u.mobileVerifiedAt)}
        init={{ name: u.name ?? "", mobile: u.mobile ?? "", business, daily: o.dailyParcels ?? "" }} />
    </AuthShell>
  );
}
