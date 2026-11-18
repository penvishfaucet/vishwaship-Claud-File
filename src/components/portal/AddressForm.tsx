"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { guessPincode } from "@/lib/pincodes";

/** Add a pickup address, or (verifyId set) run the OTP verification for an existing one. */
type Editing = { id: string; label: string; contactName: string; email: string | null; mobile: string; line1: string; line2: string | null; pincode: string; city: string; state: string };

/** Add or edit a pickup address, or (verifyId set) run the OTP verification for an existing one. */
export type SavedWarehouse = { id: string; label: string; city: string; pincode: string; verified: boolean; isDefault: boolean; mobileMasked: string };

export function AddressForm({ verifyId, mobile, editing, onDone, onSaved, onVerified, onCancel }: { verifyId?: string; mobile?: string; editing?: Editing; onDone?: () => void; onSaved?: (w: SavedWarehouse) => void; onVerified?: (id: string) => void; onCancel?: () => void }) {
  const router = useRouter();
  const [f, setF] = useState(editing
    ? { label: editing.label, contactName: editing.contactName, email: editing.email ?? "", mobile: editing.mobile, line1: editing.line1, line2: editing.line2 ?? "", pincode: editing.pincode, city: editing.city, state: editing.state }
    : { label: "", contactName: "", email: "", mobile: "", line1: "", line2: "", pincode: "", city: "", state: "" });
  const [otpFor, setOtpFor] = useState<string | null>(verifyId ?? null);
  const pinRef = useRef("");
  const [otpSent, setOtpSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    const r = await fetch(editing ? `/api/portal/warehouses/${editing.id}` : "/api/portal/warehouses", { method: editing ? "PUT" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(Object.fromEntries(Object.entries(f).map(([k, v]) => [k, SAFE_KEYS.includes(k) ? clean(String(v)).trim() : v]))) });
    const j = await r.json(); setBusy(false);
    if (!r.ok) { setErr(j.error?.issues?.[0]?.message ?? j.error?.message ?? "Could not save"); return; }
    if (editing && !j.mobileChanged) { onDone ? onDone() : router.refresh(); return; }
    const id = editing ? editing.id : j.id;
    if (j.otpRequired === false) {
      // OTP verification is switched off by Admin: the address is usable for orders straight away.
      if (!editing && onSaved) onSaved({ id, label: f.label, city: f.city, pincode: f.pincode, verified: true, isDefault: false, mobileMasked: `••••••${f.mobile.replace(/\D/g, "").slice(-4)}` });
      if (onVerified) { onVerified(id); return; }
      if (onDone) { onDone(); return; }
      router.push("/portal/addresses/"); router.refresh(); return;
    }
    if (!editing && onSaved) onSaved({ id, label: f.label, city: f.city, pincode: f.pincode, verified: false, isDefault: false, mobileMasked: `••••••${f.mobile.replace(/\D/g, "").slice(-4)}` });
    setOtpFor(id); await send(id);
  }
  async function send(id = otpFor!) {
    setBusy(true); setErr(null);
    const r = await fetch(`/api/portal/warehouses/${id}/otp`, { method: "POST" });
    const j = await r.json(); setBusy(false);
    if (!r.ok) { setErr(j.error?.message ?? "Could not send OTP"); return; }
    setOtpSent(true); setDevCode(j.devCode ?? null);
  }
  async function verify(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    const r = await fetch(`/api/portal/warehouses/${otpFor}/otp`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ code }) });
    const j = await r.json(); setBusy(false);
    if (!r.ok) { setErr(j.error?.message ?? "Incorrect code"); return; }
    if (onVerified) { onVerified(otpFor!); return; }
    router.push("/portal/addresses/"); router.refresh();
  }

  if (otpFor) {
    return (
      <div className="mt12">
        {!otpSent ? <button className="btn btn-sm btn-orange" onClick={() => send()} disabled={busy}>Send OTP to {mobile ?? "pickup mobile"}</button> : (
          <form className="row wrap" style={{ gap: 6 }} onSubmit={verify}>
            <label className="sr-only" htmlFor={`otp-${otpFor}`}>OTP</label>
            <input id={`otp-${otpFor}`} className="input" inputMode="numeric" maxLength={6} placeholder="6-digit OTP" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} style={{ maxWidth: 140 }} autoComplete="one-time-code" />
            <button className="btn btn-sm btn-orange" disabled={busy || code.length !== 6}>Verify</button>
            <button type="button" className="btn btn-sm btn-outline" onClick={() => send()} disabled={busy}>Resend</button>
          </form>
        )}
        {devCode && <p className="tiny mt8"><span className="demo-badge">DEMO SMS</span> No SMS provider is configured, so the code is shown here: <b className="mono">{devCode}</b></p>}
        {err && <p className="err tiny" role="alert">{err}</p>}
      </div>
    );
  }
  // Courier partners reject special characters in pickup addresses: only letters, numbers, spaces and commas are kept.
  const SAFE_KEYS = ["label", "contactName", "line1", "line2", "city", "state"];
  const clean = (v: string) => v.replace(/&/g, " and ").replace(/[^A-Za-z0-9 ,]/g, "").replace(/ {2,}/g, " ");
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: SAFE_KEYS.includes(k) ? clean(e.target.value) : e.target.value });
  return (
    <form className="card mb16" style={{ padding: 16 }} onSubmit={save}>
      <h2 className="b" style={{ fontSize: 15, marginTop: 0 }}>{editing ? `Edit “${editing.label}”` : "New pickup address"}</h2>
      {editing && <p className="tiny muted">Changes apply to new shipments only — existing shipments keep the address they were booked with. Changing the mobile number needs OTP verification again.</p>}
      <div className="grid3" style={{ gap: 10 }}>
        <div className="field"><label htmlFor="a-l">Label</label><input id="a-l" className="input" required value={f.label} onChange={set("label")} placeholder="Main warehouse" /></div>
        <div className="field"><label htmlFor="a-c">Contact name</label><input id="a-c" className="input" required value={f.contactName} onChange={set("contactName")} /></div>
        <div className="field"><label htmlFor="a-e">Email (optional)</label><input id="a-e" className="input" type="email" value={f.email} onChange={set("email")} /></div>
        <div className="field"><label htmlFor="a-m">Pickup mobile</label><input id="a-m" className="input" required inputMode="tel" value={f.mobile} onChange={set("mobile")} /></div>
        <div className="field" style={{ gridColumn: "span 2" }}><label htmlFor="a-1">Address</label><input id="a-1" className="input" required value={f.line1} onChange={set("line1")} aria-describedby="a-1-h" /><span id="a-1-h" className="tiny muted">Only letters, numbers, spaces and commas — courier partners reject &amp; - _ / # . ( )</span></div>
        <div className="field"><label htmlFor="a-p">PIN code</label><input id="a-p" className="input" required inputMode="numeric" maxLength={6} value={f.pincode} onChange={(e) => {
          const v = e.target.value.replace(/\D/g, "").slice(0, 6);
          setF((x) => ({ ...x, pincode: v, ...(v !== x.pincode ? { city: "", state: "" } : {}) }));
          pinRef.current = v;
          if (!/^[1-9]\d{5}$/.test(v)) return;
          fetch(`/api/portal/pincode/${v}`).then((r) => (r.ok ? r.json() : null)).then((j) => {
            if (pinRef.current !== v) return; // a newer PIN was typed
            const g = j ?? guessPincode(v);
            setF((x) => ({ ...x, city: clean(g.city || x.city).trim(), state: clean(g.state || x.state).trim() }));
          }).catch(() => undefined);
        }} /></div>
        <div className="field"><label htmlFor="a-ci">City</label><input id="a-ci" className="input" required value={f.city} onChange={set("city")} /></div>
        <div className="field"><label htmlFor="a-s">State</label><input id="a-s" className="input" required value={f.state} onChange={set("state")} /></div>
      </div>
      {err && <p className="err small" role="alert">{err}</p>}
      <div className="row mt12" style={{ gap: 8 }}><button className="btn btn-orange" disabled={busy}>{editing ? "Save changes" : "Save & verify mobile"}</button>{editing ? <button type="button" className="btn btn-outline" onClick={() => onDone?.()}>Cancel</button> : onCancel ? <button type="button" className="btn btn-outline" onClick={onCancel}>Cancel</button> : <a className="btn btn-outline" href="/portal/addresses/">Cancel</a>}</div>
    </form>
  );
}
