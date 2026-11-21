"use client";
import { useActionState, useState } from "react";
import { INDIA_DISTRICTS, INDIA_STATES } from "@/lib/india-districts";
import { type FormState, saveFranchise } from "@/server/admin/franchise-actions";

export type FranchiseFormInit = {
  id?: string; businessName: string; ownerName: string; mobile: string; email: string; gstin: string; pan: string;
  line1: string; line2: string; city: string; state: string; pincode: string;
  depositRupees: string; monthlyTarget: string; termStart: string; termEnd: string; notes: string;
};

/** Create / edit a franchise. A mistake comes back as a message and keeps what was typed. */
export function FranchiseForm({ init, defaultDepositHint }: { init: FranchiseFormInit; defaultDepositHint?: string }) {
  // Each error answer gets a new number; the form remounts with what was typed (React resets a form after its action).
  const [state, action, pending] = useActionState<(FormState & { n?: number }) | undefined, FormData>(async (prev, fd) => {
    const r = await saveFranchise(prev, fd);
    return r ? { ...r, n: (prev?.n ?? 0) + 1 } : r;
  }, undefined);
  const f =(k: keyof FranchiseFormInit, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div className="field"><label htmlFor={`f-${k}`}>{label}</label><input id={`f-${k}`} name={k} className="input" defaultValue={state?.values?.[k] ?? init[k] ?? ""} {...extra} /></div>
  );
  return (
    <form key={state?.n ?? 0} action={action} className="card" style={{ padding: 16, display: "grid", gap: 12 }} noValidate>
      {init.id && <input type="hidden" name="id" value={init.id} />}
      <h3 style={{ fontSize: 14, margin: 0 }}>Business</h3>
      <div className="grid2">
        {f("businessName", "Business name *", { required: true, maxLength: 120 })}
        {f("ownerName", "Owner name *", { required: true, maxLength: 80 })}
        {f("mobile", "Mobile *", { required: true, inputMode: "numeric", maxLength: 10, placeholder: "10-digit mobile" })}
        {f("email", "Email *", { required: true, type: "email", maxLength: 160 })}
        {f("pan", "PAN (needed for KYC)", { maxLength: 10, style: { textTransform: "uppercase" } })}
        {f("gstin", "GSTIN (if registered)", { maxLength: 15, style: { textTransform: "uppercase" } })}
      </div>
      <h3 style={{ fontSize: 14, margin: "6px 0 0" }}>Office address</h3>
      {f("line1", "Address line 1", { maxLength: 160 })}
      {f("line2", "Address line 2", { maxLength: 160 })}
      <div className="grid3">
        {f("pincode", "PIN", { inputMode: "numeric", maxLength: 6 })}
        {f("city", "City", { maxLength: 80 })}
        <div className="field"><label htmlFor="f-state">State</label>
          <select id="f-state" name="state" className="input select" defaultValue={state?.values?.state ?? init.state}><option value="">—</option>{INDIA_STATES.map((s) => <option key={s}>{s}</option>)}</select></div>
      </div>
      <h3 style={{ fontSize: 14, margin: "6px 0 0" }}>Agreement</h3>
      <div className="grid2">
        {f("depositRupees", "Security deposit (₹) *", { inputMode: "numeric", required: true })}
        {f("monthlyTarget", "Minimum shipments / month", { inputMode: "numeric" })}
        {f("termStart", "Term start", { type: "date" })}
        {f("termEnd", "Term end", { type: "date" })}
      </div>
      {defaultDepositHint && <p className="tiny muted" style={{ margin: 0 }}>{defaultDepositHint}</p>}
      <div className="field"><label htmlFor="f-notes">Internal notes (franchise never sees these)</label><textarea id="f-notes" name="notes" className="input" rows={3} maxLength={2000} defaultValue={state?.values?.notes ?? init.notes} /></div>
      {state?.error && <p className="err-box small" role="alert" style={{ margin: 0 }}>{state.error}</p>}
      <div><button className="btn btn-orange" disabled={pending}>{pending ? "Saving…" : init.id ? "Save changes" : "Create franchise"}</button></div>
    </form>
  );
}

/** State → district picker with the India district list as suggestions (a missing district can still be typed). */
export function DistrictFields({ idPrefix, defaultState = "", defaultDistrict = "" }: { idPrefix: string; defaultState?: string; defaultDistrict?: string }) {
  const [st, setSt] = useState(defaultState);
  const list = INDIA_DISTRICTS[st] ?? [];
  return (
    <>
      <div className="field"><label htmlFor={`${idPrefix}-state`}>State</label>
        <select id={`${idPrefix}-state`} name="state" className="input select" value={st} onChange={(e) => setSt(e.target.value)} required>
          <option value="">Choose state</option>{INDIA_STATES.map((s) => <option key={s}>{s}</option>)}
        </select></div>
      <div className="field" style={{ flex: 1, minWidth: 180 }}><label htmlFor={`${idPrefix}-district`}>District</label>
        <input id={`${idPrefix}-district`} name="district" className="input" list={`${idPrefix}-dl`} defaultValue={defaultDistrict} required disabled={!st} placeholder={st ? `${list.length} districts — type to search` : "Choose state first"} autoComplete="off" />
        <datalist id={`${idPrefix}-dl`}>{list.map((d) => <option key={d} value={d} />)}</datalist></div>
    </>
  );
}
