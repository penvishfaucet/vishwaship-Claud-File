"use client";
import Link from "next/link";
import { useState } from "react";
import { CalendarDays, ClipboardList, Download, FileText, History } from "lucide-react";

export const MANIFEST_NOTE = "Important: Print the manifest before pickup. Count the parcels with the pickup executive, get the manifest signed, and keep a copy as proof of handover. You may need it if your pickup does not appear in the courier panel.";

/** Generate a manifest and open its PDF (the tab is opened first so the browser does not block it). */
export async function openManifest(body: Record<string, string | undefined>): Promise<{ ok: true; manifestNo: string; awbCount: number } | { ok: false; message: string }> {
  const w = window.open("about:blank", "_blank");
  try {
    const r = await fetch("/api/portal/manifests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { w?.close(); return { ok: false, message: j.error?.message ?? "Could not create the manifest" }; }
    if (w) w.location.href = j.pdfUrl; else window.location.href = j.pdfUrl;
    return { ok: true, manifestNo: j.manifestNo, awbCount: j.awbCount };
  } catch { w?.close(); return { ok: false, message: "Network problem — try again" }; }
}

/** After booking (and on the order page): Download Label + Download Manifest for one AWB. */
export function ShipmentDocs({ shipmentId, awb, compact }: { shipmentId: string; awb: string; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className={`mf-docs${compact ? " compact" : ""}`}>
      <div className="mf-btns">
        <a className="btn btn-orange" href={`/api/portal/shipments/${shipmentId}/label`} target="_blank" rel="noopener"><Download size={16} aria-hidden /> Download Label</a>
        <button type="button" className="btn btn-navy" disabled={busy} onClick={async () => {
          setBusy(true); setMsg(null);
          const r = await openManifest({ shipmentId });
          setBusy(false);
          setMsg(r.ok ? { ok: true, text: `Manifest ${r.manifestNo} ready (AWB ${awb}). It is saved in Manifest History.` } : { ok: false, text: r.message });
        }}><ClipboardList size={16} aria-hidden /> {busy ? "Preparing…" : "Download Manifest"}</button>
      </div>
      <p className="mf-note"><b>Important:</b> Print the manifest before pickup. Count the parcels with the pickup executive, get the manifest signed, and keep a copy as proof of handover. You may need it if your pickup does not appear in the courier panel.</p>
      {msg && <p className={`small ${msg.ok ? "t-ok" : "t-bad"}`} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}
    </div>
  );
}

const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

/** Orders page: one PDF with every eligible shipment of the chosen booking date (IST), grouped by courier and pickup. */
export function DailyManifest({ couriers, warehouses }: { couriers: Array<{ code: string; name: string }>; warehouses: Array<{ id: string; label: string }> }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(istToday);
  const [courier, setCourier] = useState("");
  const [wh, setWh] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div className="mf-daily">
      <button type="button" className="mf-daily-btn" aria-expanded={open} aria-controls="mf-panel" onClick={() => setOpen((o) => !o)}><FileText size={18} aria-hidden /> Download Daily Manifest</button>
      {open && (
        <div id="mf-panel" className="mf-panel" role="region" aria-label="Daily manifest">
          <div className="mf-fields">
            <label>Booking date
              <span className="mf-in"><CalendarDays size={16} aria-hidden /><input type="date" value={date} max={istToday()} onChange={(e) => setDate(e.target.value)} /></span>
            </label>
            <label>Courier partner
              <select value={courier} onChange={(e) => setCourier(e.target.value)}><option value="">All Courier Partners</option>{couriers.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select>
            </label>
            <label>Pickup location
              <select value={wh} onChange={(e) => setWh(e.target.value)}><option value="">All Pickup Locations</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}</select>
            </label>
          </div>
          <div className="mf-btns">
            <button type="button" className="btn btn-orange" disabled={busy || !date} onClick={async () => {
              setBusy(true); setMsg(null);
              const r = await openManifest({ date, carrierCode: courier || undefined, warehouseId: wh || undefined });
              setBusy(false);
              setMsg(r.ok ? { ok: true, text: `Manifest ${r.manifestNo} — ${r.awbCount} AWB${r.awbCount === 1 ? "" : "s"}. Saved in Manifest History.` } : { ok: false, text: r.message });
            }}><Download size={16} aria-hidden /> {busy ? "Preparing…" : "Download PDF"}</button>
            <Link className="btn btn-outline" href="/portal/orders/manifests/"><History size={16} aria-hidden /> Manifest History</Link>
          </div>
          <p className="mf-note">One PDF with every shipment booked on this date that has an AWB (cancelled ones are left out). Each courier partner starts on a new page, grouped by pickup location, with its own signature and stamp area. {MANIFEST_NOTE.replace(/^Important: /, "")}</p>
          {msg && <p className={`small ${msg.ok ? "t-ok" : "t-bad"}`} role={msg.ok ? "status" : "alert"}>{msg.text}</p>}
        </div>
      )}
    </div>
  );
}
