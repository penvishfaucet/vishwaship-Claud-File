"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function EarlyCodActions({ active, eligible, termsVersion }: { active: boolean; eligible: boolean; termsVersion: number }) {
  const [accept, setAccept] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();
  async function run(body: object) {
    setBusy(true); setMsg(null);
    const r = await fetch("/api/portal/early-cod", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    setMsg(r.ok ? { ok: true, text: j.message } : { ok: false, text: j.error?.message ?? "Failed" });
    if (r.ok) router.refresh();
  }
  if (active) return (
    <div className="row wrap" style={{ gap: 8, alignItems: "center" }}>
      <button type="button" className="btn btn-outline" disabled={busy} onClick={() => { if (confirm("Cancel Early COD? Future payouts move to the standard cycle.")) run({ action: "cancel" }); }}>Cancel subscription</button>
      {msg && <span className={`small ${msg.ok ? "t-credit" : "t-debit"}`} role="status">{msg.text}</span>}
    </div>
  );
  return (
    <div className="col" style={{ gap: 8 }}>
      <label className="check small"><input type="checkbox" checked={accept} disabled={!eligible} onChange={(e) => setAccept(e.target.checked)} /> I have read and accept the Early COD terms and fee.</label>
      <div className="row wrap" style={{ gap: 8, alignItems: "center" }}>
        <button type="button" className="btn btn-orange" disabled={!eligible || !accept || busy} onClick={() => run({ action: "subscribe", acceptTerms: true, termsVersion })}>{busy ? "Subscribing…" : "Subscribe to Early COD"}</button>
        {msg && <span className={`small ${msg.ok ? "t-credit" : "t-debit"}`} role="status">{msg.text}</span>}
      </div>
    </div>
  );
}
