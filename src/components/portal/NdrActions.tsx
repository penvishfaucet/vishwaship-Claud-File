"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function NdrActions({ caseId }: { caseId: string }) {
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<null | "update_address">(null);
  const [addr, setAddr] = useState({ line1: "", mobile: "" });
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  async function act(kind: "reattempt" | "update_address" | "rto") {
    if (kind === "rto" && !confirm("Return this shipment to origin? RTO charges apply.")) return;
    setBusy(true); setErr(null);
    const r = await fetch(`/api/portal/ndr/${caseId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: kind, ...(kind === "update_address" ? addr : {}) }) });
    setBusy(false);
    if (!r.ok) { setErr((await r.json()).error?.message ?? "Failed"); return; }
    router.refresh();
  }
  if (mode === "update_address") {
    return (
      <form className="col" style={{ gap: 6, minWidth: 220 }} onSubmit={(e) => { e.preventDefault(); act("update_address"); }}>
        <input className="input" aria-label="Corrected address" placeholder="Corrected address" required value={addr.line1} onChange={(e) => setAddr({ ...addr, line1: e.target.value })} />
        <input className="input" aria-label="Alternate mobile" placeholder="Alternate mobile" inputMode="tel" value={addr.mobile} onChange={(e) => setAddr({ ...addr, mobile: e.target.value })} />
        <div className="row" style={{ gap: 6 }}><button className="btn btn-sm btn-orange" disabled={busy}>Submit</button><button type="button" className="btn btn-sm btn-outline" onClick={() => setMode(null)}>Cancel</button></div>
        {err && <span className="err tiny">{err}</span>}
      </form>
    );
  }
  return (
    <div className="row wrap" style={{ gap: 6 }}>
      <button className="btn btn-sm btn-orange" disabled={busy} onClick={() => act("reattempt")}>Reattempt</button>
      <button className="btn btn-sm btn-outline" disabled={busy} onClick={() => setMode("update_address")}>Update Address</button>
      <button className="btn btn-sm btn-outline" disabled={busy} onClick={() => act("rto")}>Request RTO</button>
      {err && <span className="err tiny" role="alert">{err}</span>}
    </div>
  );
}
