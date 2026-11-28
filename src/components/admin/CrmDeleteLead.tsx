"use client";
import { useState } from "react";

/** Owner / CRM manager: delete a test or junk lead (asks first), then go back to the list. */
export function CrmDeleteLead({ id, name }: { id: string; name: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  return (
    <div className="row wrap" style={{ gap: 8, alignItems: "center" }}>
      <button type="button" className="btn btn-sm btn-red" disabled={busy} onClick={async () => {
        if (!confirm(`Delete the lead “${name}” and its whole timeline? This cannot be undone.`)) return;
        setBusy(true); setErr("");
        const r = await fetch("/api/admin/crm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "delete", id }) });
        const j = await r.json().catch(() => ({}));
        if (r.ok) { window.location.href = "/admin/crm/"; return; }
        setBusy(false); setErr(j.error?.message ?? "Could not delete");
      }}>{busy ? "Deleting…" : "Delete this lead"}</button>
      {err && <span className="small t-debit" role="alert">{err}</span>}
    </div>
  );
}
