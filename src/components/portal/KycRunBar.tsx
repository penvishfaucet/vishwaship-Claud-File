import Link from "next/link";
import "@/styles/growth.css";

type Step = "profile" | "kyc" | "review" | "resubmit";

/** Running (scrolling) bar at the top of the portal until KYC is approved: business rates are activated after approval. */
export function KycRunBar({ step }: { step: Step }) {
  const msg: Record<Step, Array<[string, string]>> = {
    profile: [["KYC required", "to ship your first parcel"], ["Step 1", "add your pickup address"], ["Step 2", "upload your KYC documents"], ["Start shipping", "as soon as KYC is approved"]],
    kyc: [["KYC required", "to ship your first parcel"], ["Upload KYC", "PAN, Aadhaar / GST — takes 2 minutes"], ["Start shipping", "as soon as KYC is approved"]],
    review: [["KYC under review", "you can book shipments as soon as it is approved"]],
    resubmit: [["KYC needs changes", "resubmit to start shipping"], ["KYC required", "to ship your first parcel"]],
  };
  const items = [...msg[step], ...msg[step], ...msg[step]];
  const href = step === "profile" ? "/portal/onboarding/" : "/portal/kyc/";
  return (
    <div className="gp-run portal kyc" role="region" aria-label="KYC reminder">
      <Link href={href} aria-label={step === "review" ? "KYC under review — you can book shipments once it is approved" : "Complete KYC to ship your first parcel"}>
        <span className="track" aria-hidden="true">
          {items.map(([a, b], i) => <span key={i} className="it"><b>{a}</b>{b}</span>)}
        </span>
      </Link>
    </div>
  );
}
