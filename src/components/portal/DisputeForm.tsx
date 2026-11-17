"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function DisputeForm({ id, declaredKg }: { id: string; declaredKg: number }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const router = useRouter();
  if (!open) return <button type="button" className="btn btn-sm btn-orange" onClick={() => setOpen(true)}>Raise dispute</button>;
  return (
    <form className="col" style={{ gap: 6, minWidth: 240 }} onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setErr("");
      const fd = new FormData(e.currentTarget);
      const urls = String(fd.get("urls") ?? "").split(/\s+/).filter(Boolean);
      const r = await fetch(`/api/portal/disputes/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ claimedGrams: Math.round(Number(fd.get("kg")) * 1000), reason: fd.get("reason"), evidenceUrls: urls }) });
      setBusy(false);
      if (r.ok) router.refresh(); else setErr((await r.json().catch(() => ({}))).error?.message ?? "Could not submit");
    }}>
      <label className="tiny" htmlFor={`kg-${id}`}>Correct weight (kg)</label>
      <input id={`kg-${id}`} name="kg" type="number" step="0.01" min="0.01" defaultValue={declaredKg} className="input" required />
      <label className="tiny" htmlFor={`rs-${id}`}>Why is the carrier weight wrong?</label>
      <textarea id={`rs-${id}`} name="reason" className="input" rows={2} required minLength={10} maxLength={800} />
      <label className="tiny" htmlFor={`ur-${id}`}>Photo / video links (packed box on scale, with dimensions)</label>
      <input id={`ur-${id}`} name="urls" className="input" placeholder="https://… (space-separated)" />
      {err && <span className="tiny t-debit" role="alert">{err}</span>}
      <span className="row" style={{ gap: 6 }}><button className="btn btn-sm btn-orange" disabled={busy}>{busy ? "Submitting…" : "Submit dispute"}</button><button type="button" className="btn btn-sm btn-outline" onClick={() => setOpen(false)}>Cancel</button></span>
    </form>
  );
}
