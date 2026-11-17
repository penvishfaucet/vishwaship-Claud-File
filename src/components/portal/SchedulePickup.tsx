"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Truck } from "lucide-react";

export function SchedulePickup({ shipmentId, defaultDate }: { shipmentId: string; defaultDate: string }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(defaultDate);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const router = useRouter();
  if (!open) return <button type="button" className="btn btn-outline" onClick={() => setOpen(true)}><Truck size={16} /> Schedule Pickup</button>;
  return (
    <span className="row wrap" style={{ gap: 6, alignItems: "center" }}>
      <label className="sr-only" htmlFor="pud">Pickup date</label>
      <input id="pud" type="date" className="input" value={date} min={defaultDate} onChange={(e) => setDate(e.target.value)} style={{ width: 160 }} />
      <button type="button" className="btn btn-orange" disabled={busy} onClick={async () => {
        setBusy(true); setErr("");
        const r = await fetch(`/api/portal/shipments/${shipmentId}/pickup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ date }) });
        const j = await r.json().catch(() => ({}));
        setBusy(false);
        if (r.ok) { setOpen(false); router.refresh(); } else setErr(j.error?.message ?? "Could not request pickup");
      }}>{busy ? "Requesting…" : "Request pickup"}</button>
      <button type="button" className="btn btn-outline" onClick={() => setOpen(false)}>Cancel</button>
      {err && <span className="small t-debit" role="alert" style={{ flexBasis: "100%" }}>{err}</span>}
    </span>
  );
}
