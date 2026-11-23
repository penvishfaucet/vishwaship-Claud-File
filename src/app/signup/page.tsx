import { AuthShell } from "@/components/auth/AuthShell";
import { SignupForm } from "@/components/auth/Forms";
import { firebaseGoogleFrom, googleAvailable } from "@/server/auth/google";
import { firebasePhoneConfig } from "@/server/auth/firebase-phone";
import { activeFranchiseByCode, referralFromCookie } from "@/server/franchise/referral";
import { pageMeta } from "@/lib/seo";

export const dynamic = "force-dynamic";

export const metadata = pageMeta("/signup/", "Create Your Free Account — Vishwaship", "Sign up free with Vishwaship to compare courier rates, book parcels and cargo and track every shipment across India.");

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const [g, ref, phone] = await Promise.all([googleAvailable(), referralFromCookie().then(activeFranchiseByCode), firebasePhoneConfig()]);
  return (
    <AuthShell>
      {ref && <p className="note small" style={{ margin: "0 0 12px" }}>Invited by <b>{ref.businessName}</b>, Vishwaship franchise partner. They will help you with your shipping account.</p>}
      <SignupForm next={next} googleEnabled={g.enabled} googleFirebase={firebaseGoogleFrom(g, phone)} phone={phone} />
    </AuthShell>
  );
}
