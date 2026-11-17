"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { guessPincode } from "@/lib/pincodes";

/** Add a pickup address, or (verifyId set) run the OTP verification for an existing one. */
export function AddressForm({ verifyId, mobile }: { verifyId?: string; mobile?: string }) {
  const router = useRouter();
  const [f, setF] = useState({ label: "", contactName: "", mobile: "", line1: "", line2: "", pincode: "", city: "", state: "" });
  const [otpFor, setOtpFor] = useState<string | null>(verifyId ?? null);
  const [otpSent, setOtpSent] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    const r = await fetch("/api/portal/warehouses", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(f) });
    const j = await r.json(); setBusy(false);
    if (!r.ok) { setErr(j.error?.issues?.[0]?.message ?? j.error?.message ?? "Could not save"); return; }
    setOtpFor(j.id); await send(j.id);
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
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="card mb16" style={{ padding: 16 }} onSubmit={save}>
      <h2 className="b" style={{ fontSize: 15, marginTop: 0 }}>New pickup address</h2>
      <div className="grid3" style={{ gap: 10 }}>
        <div className="field"><label htmlFor="a-l">Label</label><input id="a-l" className="input" required value={f.label} onChange={set("label")} placeholder="Main warehouse" /></div>
        <div className="field"><label htmlFor="a-c">Contact name</label><input id="a-c" className="input" required value={f.contactName} onChange={set("contactName")} /></div>
        <div className="field"><label htmlFor="a-m">Pickup mobile</label><input id="a-m" className="input" required inputMode="tel" value={f.mobile} onChange={set("mobile")} /></div>
        <div className="field" style={{ gridColumn: "span 2" }}><label htmlFor="a-1">Address</label><input id="a-1" className="input" required value={f.line1} onChange={set("line1")} /></div>
        <div className="field"><label htmlFor="a-p">PIN code</label><input id="a-p" className="input" required inputMode="numeric" maxLength={6} value={f.pincode} onChange={(e) => { const v = e.target.value.replace(/\D/g, ""); const g = v.length === 6 ? guessPincode(v) : {}; setF({ ...f, pincode: v, city: f.city || g.city || "", state: f.state || g.state || "" }); }} /></div>
        <div className="field"><label htmlFor="a-ci">City</label><input id="a-ci" className="input" required value={f.city} onChange={set("city")} /></div>
        <div className="field"><label htmlFor="a-s">State</label><input id="a-s" className="input" required value={f.state} onChange={set("state")} /></div>
      </div>
      {err && <p className="err small" role="alert">{err}</p>}
      <div className="row mt12" style={{ gap: 8 }}><button className="btn btn-orange" disabled={busy}>Save &amp; verify mobile</button><a className="btn btn-outline" href="/portal/addresses/">Cancel</a></div>
    </form>
  );
}
