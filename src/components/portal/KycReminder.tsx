"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BadgePercent, X } from "lucide-react";

type Step = "profile" | "kyc" | "review" | "resubmit";
const TEXT: Record<Step, { title: string; body: string; cta?: { label: string; href: string } }> = {
  profile: { title: "Complete KYC to ship your first parcel", body: "Your account and rates are ready. Add your pickup address and upload your KYC — you can book shipments as soon as it is approved.", cta: { label: "Complete Profile", href: "/portal/onboarding/" } },
  kyc: { title: "Complete KYC to ship your first parcel", body: "Your rates are ready. Upload your KYC (PAN, Aadhaar / GST — takes 2 minutes) — you can book shipments as soon as it is approved.", cta: { label: "Complete KYC", href: "/portal/kyc/" } },
  review: { title: "KYC under review", body: "Thanks for submitting your KYC. You can book shipments as soon as it is approved — usually within a few hours." },
  resubmit: { title: "KYC needs a quick update", body: "Some KYC details need changes. Resubmit them — you can book shipments once KYC is approved.", cta: { label: "Resubmit KYC", href: "/portal/kyc/" } },
};

/**
 * KYC reminder shown once after every login (per login session) until KYC is approved.
 * `sessionKey` changes with each login, so a new login shows it again; closing it hides it for this login only.
 */
export function KycReminder({ step, sessionKey }: { step: Step; sessionKey: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const key = `vs:kycNudge:${sessionKey}`;
  useEffect(() => {
    let seen = false;
    try { seen = localStorage.getItem(key) === "1"; } catch { /* storage blocked: show once per page load */ }
    if (!seen) { const t = setTimeout(() => setOpen(true), 600); return () => clearTimeout(t); }
  }, [key]);
  useEffect(() => {
    if (!open) return;
    ref.current?.focus();
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  function close() {
    setOpen(false);
    try { localStorage.setItem(key, "1"); } catch { /* ignore */ }
  }
  if (!open) return null;
  const t = TEXT[step];
  return (
    <div className="kyc-nudge-bg" onClick={close}>
      <div className="kyc-nudge" role="dialog" aria-modal="true" aria-labelledby="kyc-nudge-h" tabIndex={-1} ref={ref} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="kyc-nudge-x" aria-label="Close" onClick={close}><X size={18} /></button>
        <span className="kyc-nudge-ico" aria-hidden><BadgePercent size={28} /></span>
        <h2 id="kyc-nudge-h">{t.title}</h2>
        <p>{t.body}</p>
        <div className="kyc-nudge-btns">
          {t.cta && <Link className="btn btn-orange" href={t.cta.href} onClick={close}>{t.cta.label}</Link>}
          <button type="button" className="btn btn-outline" onClick={close}>{t.cta ? "Later" : "OK"}</button>
        </div>
      </div>
    </div>
  );
}
