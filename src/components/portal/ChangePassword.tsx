"use client";
import { useState } from "react";

/** Change password: current one (when set), new one twice. */
export function ChangePassword() {
  const [f, setF] = useState({ current: "", next: "", again: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; err?: string } | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setMsg(null);
    if (f.next.length < 8) { setMsg({ err: "New password must be at least 8 characters" }); return; }
    if (f.next !== f.again) { setMsg({ err: "The two new passwords do not match" }); return; }
    setBusy(true);
    const r = await fetch("/api/portal/me/password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ current: f.current, next: f.next }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setBusy(false);
    if (!r || !r.ok) { setMsg({ err: j?.error?.message ?? "Could not change the password. Try again." }); return; }
    setF({ current: "", next: "", again: "" }); setMsg({ ok: "Password changed." });
  }
  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 10, maxWidth: 420 }}>
      <div className="field"><label htmlFor="pw-c">Current password</label><input id="pw-c" type="password" className="input" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></div>
      <div className="field"><label htmlFor="pw-n">New password</label><input id="pw-n" type="password" className="input" autoComplete="new-password" minLength={8} required value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} /><span className="tiny muted">At least 8 characters</span></div>
      <div className="field"><label htmlFor="pw-a">New password again</label><input id="pw-a" type="password" className="input" autoComplete="new-password" required value={f.again} onChange={(e) => setF({ ...f, again: e.target.value })} /></div>
      {msg?.err && <div className="err-box small" role="alert">{msg.err}</div>}
      {msg?.ok && <p className="small" role="status" style={{ margin: 0, color: "var(--green, #15803d)" }}>{msg.ok}</p>}
      <div><button className="btn btn-orange" disabled={busy}>{busy ? "Saving…" : "Change password"}</button></div>
    </form>
  );
}
