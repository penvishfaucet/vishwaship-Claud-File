import { AuthShell } from "@/components/auth/AuthShell";
import { SignupForm } from "@/components/auth/Forms";
import { googleAvailable } from "@/server/auth/google";
import { activeFranchiseByCode, referralFromCookie } from "@/server/franchise/referral";

export const dynamic = "force-dynamic";

export const metadata = { title: "Sign up — Vishwaship" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const [g, ref] = await Promise.all([googleAvailable(), referralFromCookie().then(activeFranchiseByCode)]);
  return (
    <AuthShell>
      {ref && <p className="note small" style={{ margin: "0 0 12px" }}>Invited by <b>{ref.businessName}</b>, Vishwaship franchise partner. They will help you with your shipping account.</p>}
      <SignupForm next={next} googleEnabled={g.enabled} />
    </AuthShell>
  );
}
