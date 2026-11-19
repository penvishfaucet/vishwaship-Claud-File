import Link from "next/link";
import { eq } from "drizzle-orm";
import { CheckCircle2 } from "lucide-react";
import { ProfileForm } from "@/components/portal/ProfileForm";
import { getDb, schema } from "@/server/db/client";
import { onboardingState, STEP_TEXT, type OnboardingStep } from "@/server/onboarding";
import { portalContext } from "@/server/portal/context";

export const metadata = { title: "Complete Your Profile — Vishwaship" };
const ORDER: OnboardingStep[] = ["profile", "kyc", "review", "active"];

/** Onboarding: Complete Your Profile, then KYC; shows where the customer stands so they can continue any time. */
export default async function OnboardingPage() {
  const ctx = await portalContext();
  const db = await getDb();
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, ctx.session.userId));
  const st = await onboardingState(ctx.org.id);
  const a = (ctx.org.address ?? {}) as { line1?: string; line2?: string; city?: string; state?: string; pincode?: string };
  const now = st.step === "resubmit" ? 1 : ORDER.indexOf(st.step);
  return (
    <div className="tk-page" style={{ maxWidth: 820 }}>
      <h1 style={{ fontSize: 22, margin: 0 }}>{st.step === "profile" ? "Complete Your Profile" : STEP_TEXT[st.step].title}</h1>
      <ol className="ob-steps" aria-label="Account activation">
        {["Profile", "KYC", "Admin review", "Account Active"].map((t, i) => (
          <li key={t} className={i < now || st.step === "active" ? "done" : i === now ? "now" : ""}>{i < now || st.step === "active" ? <CheckCircle2 size={16} aria-hidden /> : <span>{i + 1}</span>} {t}</li>
        ))}
      </ol>
      {st.step !== "profile" && (
        <div className="note small">
          {st.step === "kyc" && <>Your profile is saved. Next: <Link className="link" href="/portal/kyc/">Complete KYC</Link>.</>}
          {st.step === "review" && <>Your KYC is under review. Booking unlocks as soon as Vishwaship approves it. You can still update your profile below.</>}
          {st.step === "resubmit" && <>KYC needs changes{st.reasons.length ? <>: <b>{st.reasons.join(" · ")}</b></> : null}. <Link className="link" href="/portal/kyc/">Resubmit KYC</Link></>}
          {st.step === "active" && <>Your account is active. <Link className="link" href="/portal/orders/create/">Create an order</Link></>}
        </div>
      )}
      <p className="small muted" style={{ margin: 0 }}>We use these details on invoices, pickups and KYC. Fields marked * are required.</p>
      <ProfileForm init={{ name: u?.name ?? "", mobile: u?.mobile ?? "", business: ctx.org.businessName === u?.name ? "" : ctx.org.businessName, gstin: ctx.org.gstin ?? "", volume: ctx.org.expectedMonthlyVolume ?? "",
        line1: a.line1 ?? "", line2: a.line2 ?? "", pincode: a.pincode ?? "", city: a.city ?? "", state: a.state ?? "" }} />
    </div>
  );
}
