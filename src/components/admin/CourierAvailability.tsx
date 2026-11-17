"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function CourierAvailability({ couriers, disabled, write }: { couriers: Array<{ code: string; name: string; offered: boolean; optedOut: number }>; disabled: string[]; write: boolean }) {
  const [off, setOff] = useState(new Set(disabled));
  const [msg, setMsg] = useState("");
  const router = useRouter();
  async function save() {
    const r = await fetch("/api/admin/commercial", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op: "courier_availability", disabled: [...off] }) });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? j.message : j.error?.message ?? "Failed");
    if (r.ok) router.refresh();
  }
  return (
    <>
      <div className="tbl-wrap"><table className="tbl">
        <thead><tr><th>Courier</th><th>Connected</th><th>Customers who hid it</th><th>Available to customers</th></tr></thead>
        <tbody>{couriers.map((c) => (
          <tr key={c.code}><td className="small b">{c.name}</td><td>{c.offered ? <span className="chip c-active">Quoted recently</span> : <span className="chip c-draft">No live service</span>}</td><td className="small">{c.optedOut}</td>
            <td><label className="check small"><input type="checkbox" checked={!off.has(c.code)} disabled={!write} onChange={() => setOff((s) => { const n = new Set(s); if (n.has(c.code)) n.delete(c.code); else n.add(c.code); return n; })} /> {off.has(c.code) ? "Off for everyone" : "On"}</label></td></tr>
        ))}</tbody>
      </table></div>
      {write && <div className="row" style={{ gap: 10, padding: 12, alignItems: "center" }}><button type="button" className="btn btn-orange btn-sm" onClick={save}>Save availability</button>{msg && <span className="small" role="status">{msg}</span>}</div>}
    </>
  );
}
