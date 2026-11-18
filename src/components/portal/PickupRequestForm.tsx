"use client";
import { AwbLink, portalTrackHref } from "@/components/IdLinks";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

type Row = { id: string; warehouseId: string; orderNumber: string; awb: string | null; carrier: string; code: string | null; boxes: number; pickup: string; auto: boolean };
type WH = { id: string; label: string; pincode: string };

/** Customer: choose a pickup address and date, tick shipments, and generate the courier pickup request (PR). */
export function PickupRequestForm({ warehouses, rows, today }: { warehouses: WH[]; rows: Row[]; today: string }) {
  const router = useRouter();
  const [wh, setWh] = useState(warehouses.find((w) => rows.some((r) => r.warehouseId === w.id))?.id ?? warehouses[0]?.id ?? "");
  const [date, setDate] = useState(today);
  const list = useMemo(() => rows.filter((r) => r.warehouseId === wh), [rows, wh]);
  const [sel, setSel] = useState<string[]>(() => list.filter((r) => r.pickup === "not_scheduled").map((r) => r.id));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; lines: string[] } | null>(null);
  const toggle = (id: string) => setSel((x) => (x.includes(id) ? x.filter((y) => y !== id) : [...x, id]));

  async function submit() {
    setBusy(true); setMsg(null);
    const r = await fetch("/api/portal/pickups", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ warehouseId: wh, date, shipmentIds: sel }) });
    const j = await r.json(); setBusy(false);
    if (!r.ok) { setMsg({ ok: false, lines: [j.error?.message ?? "Could not create the pickup request"] }); return; }
    const res = j.results as Array<{ orderNumber: string; ok: boolean; message: string; pickupRef?: string | null }>;
    setMsg({ ok: res.every((x) => x.ok), lines: res.map((x) => `${x.orderNumber}: ${x.message}${x.pickupRef ? ` · PR ${x.pickupRef}` : ""}`) });
    router.refresh();
  }

  return (
    <section className="card" style={{ padding: 16 }}>
      <h2 className="b" style={{ fontSize: 15, marginTop: 0 }}>Generate pickup request</h2>
      <div className="row wrap" style={{ gap: 10, alignItems: "end" }}>
        <div className="field"><label htmlFor="pr-wh">Pickup address</label>
          <select id="pr-wh" className="select" value={wh} onChange={(e) => { setWh(e.target.value); setSel(rows.filter((r) => r.warehouseId === e.target.value && r.pickup === "not_scheduled").map((r) => r.id)); }}>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.label} ({w.pincode}) — {rows.filter((r) => r.warehouseId === w.id).length} shipment(s)</option>)}
          </select></div>
        <div className="field"><label htmlFor="pr-d">Pickup date</label><input id="pr-d" type="date" className="input" min={today} value={date} onChange={(e) => setDate(e.target.value)} /></div>
        <button type="button" className="btn btn-orange" disabled={busy || !sel.length} onClick={submit}>{busy ? "Requesting…" : `Generate pickup request (${sel.length})`}</button>
      </div>
      {list.length === 0 ? <p className="small muted mt12">No booked shipments waiting for pickup at this address.</p> : (
        <div className="tbl-wrap mt12"><table className="tbl"><thead><tr><th /><th>Order</th><th>AWB / LR</th><th>Courier</th><th>Boxes</th><th>Pickup</th></tr></thead>
          <tbody>{list.map((r) => (
            <tr key={r.id}>
              <td><input type="checkbox" aria-label={`Include ${r.orderNumber}`} checked={sel.includes(r.id)} onChange={() => toggle(r.id)} /></td>
              <td className="small">{r.orderNumber}</td><td className="tiny"><AwbLink value={r.awb} href={portalTrackHref(r.awb)} /></td>
              <td className="small">{r.carrier}{r.code ? <span className="tiny muted"> · {r.code}</span> : null}</td><td className="small">{r.boxes}</td>
              <td className="small">{r.pickup === "scheduled" ? "Requested" : r.auto ? "Courier schedules automatically" : "Not requested"}</td>
            </tr>
          ))}</tbody></table></div>
      )}
      {msg && <div className={`${msg.ok ? "note" : "err-box"} small mt12`} role="status">{msg.lines.map((l) => <div key={l}>{l}</div>)}</div>}
      <p className="tiny muted mt8">One request per pickup address and date: the courier gets a pickup request ID (PR) and sends a pickup agent. Shipments already in a request are not requested twice.</p>
    </section>
  );
}
