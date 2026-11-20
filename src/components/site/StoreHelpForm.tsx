"use client";
import { useState } from "react";

export function StoreHelpForm() {
  const [f, setF] = useState({ name: "", mobile: "", email: "", message: "", website: "" });
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<{ ok?: boolean; msg?: string }>({});
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setState({});
    try {
      const r = await fetch("/api/public/store-help", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(f) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setState({ ok: false, msg: j?.error?.message ?? "Could not send. Please try again." });
      else { setState({ ok: true, msg: "Thank you! Our team will call you within one working day." }); setF({ name: "", mobile: "", email: "", message: "", website: "" }); }
    } catch { setState({ ok: false, msg: "Network error. Please try again." }); }
    setBusy(false);
  }
  return (
    <form className="w-card w-form" onSubmit={submit} style={{ padding: 24, display: "grid", gap: 14, marginTop: 16 }}>
      <div className="w-fld"><label htmlFor="sh-n">Your name</label><input id="sh-n" className="w-in" required maxLength={80} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" /></div>
      <div className="w-fld"><label htmlFor="sh-m">Mobile number</label><input id="sh-m" className="w-in" required inputMode="numeric" maxLength={10} value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value.replace(/\D/g, "") })} autoComplete="tel-national" placeholder="10-digit mobile" /></div>
      <div className="w-fld"><label htmlFor="sh-e">Email (optional)</label><input id="sh-e" className="w-in" type="email" maxLength={120} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="email" /></div>
      <div className="w-fld"><label htmlFor="sh-q">What do you sell? (optional)</label><textarea id="sh-q" className="w-in" rows={3} maxLength={1000} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} /></div>
      {/* honeypot: real visitors never see or fill this */}
      <input tabIndex={-1} aria-hidden="true" autoComplete="off" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} style={{ position: "absolute", left: -9999, width: 1, height: 1 }} name="website" />
      <div className="w-btns"><button className="w-btn pri" disabled={busy}>{busy ? "Sending…" : "Request a call back"}</button></div>
      {state.msg && <p role={state.ok ? "status" : "alert"} style={{ margin: 0, color: state.ok ? "#1e7b3a" : "#b42318" }}>{state.msg}</p>}
    </form>
  );
}
