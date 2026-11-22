"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatINR } from "@/lib/money";

type Row = { line: number; ref: string; status: string; message?: string; note?: string; receiverExtraPaise?: number; orgName?: string; carrierName?: string; bookedGrams?: number; carrierGrams?: number; courierExtraPaise?: number | null; chargePaise?: number };
type Res = { rows: Row[]; created: number; totalChargePaise: number };

const kg = (g?: number) => (g ? `${(g / 1000).toFixed(2)} kg` : "—");
const LABEL: Record<string, string> = { ok: "Will raise", not_found: "AWB not found", no_extra: "No extra weight", exists: "Already raised", no_quote: "No booking quote", invalid: "Invalid row" };

/** Admin: upload the courier's weight report (CSV), check the preview, then raise discrepancies for the clients. */
export function WeightImport() {
  const [csv, setCsv] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [res, setRes] = useState<Res | null>(null);
  const [done, setDone] = useState(false);
  const router = useRouter();

  async function send(commit: boolean) {
    if (commit && !confirm(`Raise ${res?.rows.filter((r) => r.status === "ok").length ?? 0} weight discrepancies? Clients get ${7} days to dispute; undisputed ones are then debited from their wallet.`)) return;
    setBusy(true); setMsg("");
    const r = await fetch("/api/admin/disputes/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ csv, commit }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg(j.error?.message ?? "Failed"); return; }
    setRes(j); setDone(commit);
    if (commit) { setMsg(`${j.created} discrepancies raised · ${formatINR(j.totalChargePaise)}`); router.refresh(); }
  }

  const ok = res?.rows.filter((r) => r.status === "ok") ?? [];
  return (
    <div className="card mb12">
      <h2 className="h3" style={{ marginTop: 0 }}>Courier weight discrepancy — paste e-mail or upload report</h2>
      <p className="small" style={{ margin: "0 0 8px" }}>Easiest: open the courier e-mail (e.g. “LR … charged weight of this LR is 41 kg … increased from INR 739.19 to INR 885.74”), select all, copy and paste it below. Several e-mails can be pasted together.</p>
      <textarea className="input mb8" rows={5} style={{ width: "100%" }} placeholder="Paste the courier e-mail text here" value={name ? "" : csv} onChange={(e) => { setName(""); setCsv(e.target.value); setRes(null); setDone(false); setMsg(""); }} />
      <p className="small muted" style={{ margin: "0 0 8px" }}>CSV with an <b>AWB / LR</b> column and a <b>charged weight</b> column (kg; grams if the header says g / gm). An optional <b>extra charge</b> column (₹, before GST) uses the courier’s own extra amount; otherwise the booking rate is re-rated for the new weight. Client price uses the same markup as at booking, plus GST.<br />Aggregator panel export (Weight Discrepancies → Download) works as is: extra = courier weight charges − entered weight charges (GST basis read from our booked cost); the client’s dispute deadline is set 2 days before the aggregator’s 8-day window closes.</p>
      <div className="row wrap" style={{ gap: 8, alignItems: "center" }}>
        <input type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; setName(f.name); setCsv(await f.text()); setRes(null); setDone(false); setMsg(""); }} />
        <button type="button" className="btn btn-sm btn-outline" disabled={busy || !csv} onClick={() => send(false)}>Preview</button>
        {res && !done && ok.length > 0 && <button type="button" className="btn btn-sm btn-navy" disabled={busy} onClick={() => send(true)}>Raise {ok.length} · {formatINR(res.totalChargePaise)}</button>}
        {name && <span className="tiny muted">{name}</span>}
        {msg && <span className="tiny" role="status">{msg}</span>}
      </div>
      {res && (
        <div className="tbl-wrap mt8" style={{ maxHeight: 420, overflow: "auto" }}><table className="tbl">
          <thead><tr><th>Row</th><th>AWB / LR</th><th>Customer</th><th>Booked</th><th>Courier</th><th>Courier extra</th><th>Client wallet charge</th><th>Receiver pays more (FoD)</th><th>Result</th></tr></thead>
          <tbody>{res.rows.map((r) => (
            <tr key={r.line}><td className="tiny">{r.line}</td><td className="mono tiny">{r.ref || "—"}</td><td className="small">{r.orgName ?? "—"}<div className="tiny muted">{r.carrierName}</div></td>
              <td className="small">{kg(r.bookedGrams)}</td><td className="small b">{kg(r.carrierGrams)}</td><td className="small">{r.courierExtraPaise ? formatINR(r.courierExtraPaise) : "—"}</td>
              <td className="small b">{r.chargePaise ? formatINR(r.chargePaise) : "—"}</td><td className="small">{r.receiverExtraPaise ? formatINR(r.receiverExtraPaise) : "—"}</td>
              <td className="tiny"><span className={`chip ${r.status === "ok" ? "c-active" : "c-draft"}`}>{r.status === "ok" && done ? "Raised" : LABEL[r.status] ?? r.status}</span>{r.message && <div className="muted">{r.message}</div>}{r.note && <div className="muted">{r.note}</div>}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}
