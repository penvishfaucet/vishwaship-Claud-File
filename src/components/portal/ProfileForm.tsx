"use client";
import { useActionState, useState } from "react";
import { type ProfileState, saveProfile } from "@/server/portal/onboarding-actions";

type Init = { name: string; mobile: string; business: string; gstin: string; volume: string; line1: string; line2: string; pincode: string; city: string; state: string };

/** Complete Your Profile (both signup methods). PIN fills City / State. */
export function ProfileForm({ init }: { init: Init }) {
  const [state, action, pending] = useActionState<ProfileState, FormData>(saveProfile, undefined);
  const [pin, setPin] = useState(init.pincode);
  const [city, setCity] = useState(init.city);
  const [st, setSt] = useState(init.state);
  async function lookup(v: string) {
    if (!/^[1-9]\d{5}$/.test(v)) return;
    const r = await fetch(`/api/portal/pincode/${v}`).catch(() => null);
    if (r?.ok) { const j = await r.json(); setCity(j.city ?? ""); setSt(j.state ?? ""); }
  }
  const bad = (f: string) => state?.field === f;
  return (
    <form action={action} className="card ob-form" noValidate>
      <div className="grid2">
        <div className="field"><label htmlFor="name">Full name <span className="req">*</span></label><input id="name" name="name" className="input" defaultValue={init.name} required autoComplete="name" aria-invalid={bad("name")} /></div>
        <div className="field"><label htmlFor="mobile">Mobile number <span className="req">*</span></label><input id="mobile" name="mobile" className="input" defaultValue={init.mobile} inputMode="numeric" maxLength={10} placeholder="10-digit mobile" required autoComplete="tel-national" aria-invalid={bad("mobile")} /></div>
        <div className="field"><label htmlFor="business">Business / brand name <span className="req">*</span></label><input id="business" name="business" className="input" defaultValue={init.business} required autoComplete="organization" aria-invalid={bad("business")} /></div>
        <div className="field"><label htmlFor="gstin">GSTIN (if registered)</label><input id="gstin" name="gstin" className="input" defaultValue={init.gstin} maxLength={15} placeholder="Optional" aria-invalid={bad("gstin")} /></div>
      </div>
      <div className="field"><label htmlFor="line1">Address line 1 <span className="req">*</span></label><input id="line1" name="line1" className="input" defaultValue={init.line1} placeholder="Building, street" required autoComplete="address-line1" aria-invalid={bad("line1")} /></div>
      <div className="field"><label htmlFor="line2">Address line 2</label><input id="line2" name="line2" className="input" defaultValue={init.line2} placeholder="Area, landmark" autoComplete="address-line2" /></div>
      <div className="grid3">
        <div className="field"><label htmlFor="pincode">PIN code <span className="req">*</span></label><input id="pincode" name="pincode" className="input" value={pin} inputMode="numeric" maxLength={6} required aria-invalid={bad("pincode")}
          onChange={(e) => { const v = e.target.value.replace(/\D/g, "").slice(0, 6); setPin(v); if (v.length === 6) void lookup(v); }} autoComplete="postal-code" /></div>
        <div className="field"><label htmlFor="city">City <span className="req">*</span></label><input id="city" name="city" className="input" value={city} onChange={(e) => setCity(e.target.value)} required aria-invalid={bad("city")} /></div>
        <div className="field"><label htmlFor="state">State <span className="req">*</span></label><input id="state" name="state" className="input" value={st} onChange={(e) => setSt(e.target.value)} required aria-invalid={bad("state")} /></div>
      </div>
      <div className="field"><label htmlFor="volume">Monthly shipments</label>
        <select id="volume" name="volume" className="select" defaultValue={init.volume || "100 – 500"}><option>0 – 100</option><option>100 – 500</option><option>500 – 2,000</option><option>2,000+</option></select></div>
      {state?.error && <p className="err small" role="alert">{state.error}</p>}
      <button className="btn btn-orange btn-lg" disabled={pending}>{pending ? "Saving…" : "Save & continue to KYC"}</button>
    </form>
  );
}
