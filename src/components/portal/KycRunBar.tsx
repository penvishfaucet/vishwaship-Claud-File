import Link from "next/link";
import "@/styles/growth.css";

type Step = "profile" | "kyc" | "review" | "resubmit";

/** Running (scrolling) bar at the top of the portal until KYC is approved: business rates are activated after approval. */
export function KycRunBar({ step }: { step: Step }) {
  const msg: Record<Step, Array<[string, string]>> = {
    profile: [["Please approve your KYC", "for the best business rates"], ["Step 1", "add your mobile number and pickup address"], ["Step 2", "upload your KYC documents"], ["Business rates", "activated as soon as KYC is approved"]],
    kyc: [["Please approve your KYC", "for the best business rates"], ["Upload KYC", "PAN, Aadhaar / GST — takes 2 minutes"], ["Business rates", "activated as soon as KYC is approved"]],
    review: [["KYC under review", "business rates are activated as soon as it is approved"], ["Keep shipping", "standard rates apply meanwhile"]],
    resubmit: [["KYC needs changes", "resubmit to get business rates activated"], ["Please approve your KYC", "for the best business rates"]],
  };
  const items = [...msg[step], ...msg[step], ...msg[step]];
  const href = step === "profile" ? "/portal/onboarding/" : "/portal/kyc/";
  return (
    <div className="gp-run portal kyc" role="region" aria-label="KYC reminder">
      <Link href={href} aria-label={step === "review" ? "KYC under review — business rates are activated once approved" : "Please approve your KYC for the best business rates"}>
        <span className="track" aria-hidden="true">
          {items.map(([a, b], i) => <span key={i} className="it"><b>{a}</b>{b}</span>)}
        </span>
      </Link>
    </div>
  );
}
