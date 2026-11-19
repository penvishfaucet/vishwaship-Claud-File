"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Download, FileCheck2, Upload } from "lucide-react";

export type ManifestItem = { id: string; manifestNo: string; scope: string; bookingDate: string; awbCount: number; boxCount: number; createdAt: string; couriers: string[]; awbs: string[]; signed: null | { name: string; uploadedAt: string } };
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });
const day = (d: string) => new Date(`${d}T12:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });

/** Manifest History: original PDF by Manifest ID, and the signed copy (upload / view). */
export function ManifestHistory({ items }: { items: ManifestItem[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Record<string, { ok: boolean; text: string }>>({});
  const input = useRef<HTMLInputElement>(null);
  const target = useRef<string | null>(null);
  async function upload(id: string, f: File) {
    setBusy(id);
    const fd = new FormData(); fd.set("file", f);
    const r = await fetch(`/api/portal/manifests/${id}/signed`, { method: "POST", body: fd }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setBusy(null);
    setMsg((m) => ({ ...m, [id]: r?.ok ? { ok: true, text: "Signed copy saved." } : { ok: false, text: j.error?.message ?? "Upload failed — try again" } }));
    if (r?.ok) router.refresh();
  }
  if (!items.length) return <div className="tk-empty"><p>No manifests yet. Download one from a booked shipment or with “Download Daily Manifest” on the Orders page.</p></div>;
  return (
    <>
      <input ref={input} type="file" hidden accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => { const f = e.target.files?.[0]; if (f && target.current) void upload(target.current, f); e.target.value = ""; }} />
      <ul className="mf-list">
        {items.map((m) => (
          <li key={m.id} className="mf-item">
            <div className="mf-item-h"><b>{m.manifestNo}</b><span className="tk-st resolved">{m.scope === "daily" ? "Daily" : "Single shipment"}</span></div>
            <div className="small">Booking date <b>{day(m.bookingDate)}</b> · {m.awbCount} AWB{m.awbCount === 1 ? "" : "s"} · {m.boxCount} box{m.boxCount === 1 ? "" : "es"} · {m.couriers.join(", ")}</div>
            <div className="tiny muted">Generated {when(m.createdAt)} · AWBs: {m.awbs.slice(0, 6).join(", ")}{m.awbs.length > 6 ? ` +${m.awbs.length - 6} more` : ""}</div>
            <div className="mf-btns">
              <a className="btn btn-sm btn-outline" href={`/api/portal/manifests/${m.id}/pdf`} target="_blank" rel="noopener"><Download size={14} aria-hidden /> Original PDF</a>
              {m.signed && <a className="btn btn-sm btn-outline" href={`/api/portal/manifests/${m.id}/signed`} target="_blank" rel="noopener"><FileCheck2 size={14} aria-hidden /> Signed copy</a>}
              <button type="button" className="btn btn-sm btn-navy" disabled={busy === m.id} onClick={() => { target.current = m.id; input.current?.click(); }}>
                <Upload size={14} aria-hidden /> {busy === m.id ? "Uploading…" : m.signed ? "Replace signed copy" : "Upload Signed Copy"}
              </button>
            </div>
            {m.signed && <p className="tiny muted">Signed copy “{m.signed.name}” uploaded {when(m.signed.uploadedAt)}</p>}
            {msg[m.id] && <p className={`small ${msg[m.id].ok ? "t-ok" : "t-bad"}`} role={msg[m.id].ok ? "status" : "alert"}>{msg[m.id].text}</p>}
          </li>
        ))}
      </ul>
    </>
  );
}
