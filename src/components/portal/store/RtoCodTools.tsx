"use client";
import { Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api } from "./ui";

const rs = (p: number | null) => (p === null ? "—" : `${p < 0 ? "−" : ""}₹${Math.abs(p / 100).toLocaleString("en-IN", { minimumFractionDigits: p % 100 ? 2 : 0, maximumFractionDigits: 2 })}`);

/** Ask Vishwaship about the COD money of one shipment. */
export function CodQuestion({ shipmentId, awb }: { shipmentId: string; awb: string | null }) {
  const router = useRouter();
  const dlg = useRef<HTMLDialogElement>(null);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function send(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr("");
    const r = await api("POST", "/api/portal/store/rto-cod", { action: "dispute", shipmentId, note });
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    dlg.current?.close(); router.refresh();
  }
  return (
    <>
      <button type="button" className="btn btn-outline btn-sm" onClick={() => { setNote(""); setErr(""); dlg.current?.showModal(); }}>Question</button>
      <dialog ref={dlg} className="so-dialog" aria-labelledby={`q-${shipmentId}`}>
        <form onSubmit={send} style={{ display: "grid", gap: 10 }}>
          <h3 id={`q-${shipmentId}`} style={{ margin: 0, fontSize: 16 }}>COD question · AWB {awb ?? "—"}</h3>
          <textarea className="input" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Delivered on 12 Nov but not in any payout" required minLength={5} />
          {err && <div className="err-box small" role="alert">{err}</div>}
          <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
            <button type="button" className="btn btn-outline" onClick={() => dlg.current?.close()}>Cancel</button>
            <button className="btn btn-orange" disabled={busy}>{busy ? "Sending…" : "Send to Vishwaship"}</button>
          </div>
        </form>
      </dialog>
    </>
  );
}

type Cmp = { rows: Array<{ row: number; awb: string; filePaise: number | null; oursPaise: number | null; ourUtr: string | null; fileUtr: string | null; result: string; diffPaise: number; orderNumber: string | null }>;
  missing: Array<{ awb: string; orderNumber: string; oursPaise: number; utr: string | null }>; summary: Record<string, number> };
const RESULT: Record<string, string> = { matched: "Matched", amount_differs: "Amount differs", utr_differs: "UTR differs", unknown_awb: "AWB not in your account", not_remitted: "Not paid out in our records", bad_row: "Row unreadable" };

/** Check a payout / bank statement CSV against our COD records. Nothing is changed. */
export function CompareCod() {
  const file = useRef<HTMLInputElement>(null);
  const [res, setRes] = useState<Cmp | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [onlyIssues, setOnlyIssues] = useState(true);
  async function pick(f?: File) {
    if (!f) return;
    setErr(""); setRes(null);
    if (f.size > 2_000_000) { setErr("File is too big (2 MB max)"); return; }
    setBusy(true);
    const r = await api<Cmp>("POST", "/api/portal/store/rto-cod", { action: "compare", text: await f.text() });
    setBusy(false);
    if (file.current) file.current.value = "";
    if (!r.ok) setErr(r.error); else setRes(r.data);
  }
  const rows = res ? res.rows.filter((r) => !onlyIssues || r.result !== "matched") : [];
  return (
    <div className="card" style={{ padding: 14, display: "grid", gap: 10 }}>
      <p className="small muted" style={{ margin: 0 }}>Upload a CSV from your bank or payout statement with columns <b>awb, amount</b> (optional <b>utr</b>). We compare it with our COD records and show every difference. Nothing is changed.</p>
      <div><button type="button" className="btn btn-orange btn-sm" disabled={busy} onClick={() => file.current?.click()}><Upload size={14} aria-hidden /> {busy ? "Checking…" : "Choose CSV file"}</button>
        <input ref={file} type="file" accept=".csv,text/csv" hidden onChange={(e) => void pick(e.target.files?.[0])} /></div>
      {err && <div className="err-box small" role="alert">{err}</div>}
      {res && (
        <>
          <div className="so-kpis" style={{ marginBottom: 0 }}>
            {([["matched", "Matched"], ["amountDiffers", "Amount differs"], ["notRemitted", "Not paid out (ours)"], ["unknown", "Unknown AWB"], ["missing", "Paid by us, missing in file"]] as const).map(([k, l]) =>
              <div key={k} className={`card so-kpi${k !== "matched" && res.summary[k] ? " hot" : ""}`}><b>{res.summary[k] ?? 0}</b><span>{l}</span></div>)}
          </div>
          <label className="row small" style={{ gap: 8, alignItems: "center" }}><input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} /> Show only differences</label>
          <ul className="dp-files">
            {rows.map((r) => <li key={r.row}><span className="small" style={{ overflowWrap: "anywhere" }}><b>{r.awb || `Row ${r.row}`}</b>{r.orderNumber ? ` · ${r.orderNumber}` : ""} · {RESULT[r.result]}
              <span className="tiny muted"> · file {rs(r.filePaise)} · ours {rs(r.oursPaise)}{r.diffPaise ? ` · difference ${rs(r.diffPaise)}` : ""}{r.result === "utr_differs" ? ` · UTR ${r.fileUtr} vs ${r.ourUtr}` : ""}</span></span></li>)}
            {res.missing.map((m) => <li key={m.awb}><span className="small"><b>{m.awb}</b> · {m.orderNumber} · paid {rs(m.oursPaise)}{m.utr ? ` (UTR ${m.utr})` : ""} <span className="red">not in your file</span></span></li>)}
            {!rows.length && !res.missing.length && <li className="small">Everything matches.</li>}
          </ul>
        </>
      )}
    </div>
  );
}
