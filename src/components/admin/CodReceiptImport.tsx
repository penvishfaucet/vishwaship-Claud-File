"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatINR } from "@/lib/money";

type Row = { line: number; awb: string; amountPaise: number; utr: string | null; remittedOn: string | null; status: string; expectedPaise: number | null; orgName: string | null; orderNumber: string | null; message?: string };
type Res = { rows: Row[]; matched: number; flagged: number; totalPaise: number };

const LABEL: Record<string, string> = { matched: "Received in full", accepted: "Accepted earlier", short: "Courier paid less", excess: "Courier paid more", unknown_awb: "AWB not found", not_cod: "Not a COD order", invalid: "Skipped" };

/** Admin: the courier's COD remittance file (Shipmozo panel export / Delhivery attachment) or e-mail → preview → record. */
export function CodReceiptImport() {
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [res, setRes] = useState<Res | null>(null);
  const [done, setDone] = useState(false);
  const router = useRouter();

  async function send(commit: boolean) {
    setBusy(true); setMsg("");
    const fd = new FormData();
    if (file) fd.set("file", file); else fd.set("text", text);
    fd.set("commit", String(commit));
    const r = await fetch("/api/admin/cod/receipts", { method: "POST", body: fd });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg(j.error?.message ?? "Failed"); return; }
    setRes(j); setDone(commit);
    if (commit) { setMsg(`Recorded: ${j.matched} ready to pay, ${j.flagged} to check · ${formatINR(j.totalPaise)}`); router.refresh(); }
  }
  const reset = () => { setRes(null); setDone(false); setMsg(""); };

  return (
    <div className="card mb16">
      <h2 className="h3" style={{ marginTop: 0 }}>1 · COD received from the courier</h2>
      <p className="small" style={{ margin: "0 0 8px" }}>Delhivery COD remittance e-mails are read automatically. For Shipmozo, download the COD remittance report from its panel (Excel / CSV) and upload it here. You can also paste a remittance e-mail. Columns needed: <b>AWB / Waybill</b> and <b>COD amount</b>; UTR and remittance date are read when present.</p>
      <div className="row wrap" style={{ gap: 8, alignItems: "center" }}>
        <input type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setText(""); reset(); }} />
        <button type="button" className="btn btn-sm btn-outline" disabled={busy || (!file && !text.trim())} onClick={() => send(false)}>Preview</button>
        {res && !done && res.rows.length > 0 && <button type="button" className="btn btn-sm btn-navy" disabled={busy} onClick={() => send(true)}>Record {res.rows.filter((r) => r.status !== "invalid").length} AWB · {formatINR(res.totalPaise)}</button>}
        {msg && <span className="tiny" role="status">{msg}</span>}
      </div>
      {!file && <textarea className="input mt8" rows={3} style={{ width: "100%" }} placeholder="…or paste the courier's COD remittance e-mail here" value={text} onChange={(e) => { setText(e.target.value); reset(); }} />}
      {res && (
        <div className="tbl-wrap mt8" style={{ maxHeight: 380, overflow: "auto" }}><table className="tbl">
          <thead><tr><th>Row</th><th>AWB</th><th>Client / order</th><th style={{ textAlign: "right" }}>Order COD</th><th style={{ textAlign: "right" }}>Courier paid</th><th>UTR</th><th>Result</th></tr></thead>
          <tbody>{res.rows.map((r) => (
            <tr key={`${r.line}-${r.awb}`}><td className="tiny">{r.line}</td><td className="mono tiny">{r.awb}</td><td className="small">{r.orgName ?? "—"}<div className="tiny muted">{r.orderNumber}</div></td>
              <td style={{ textAlign: "right" }} className="small">{r.expectedPaise != null ? formatINR(r.expectedPaise) : "—"}</td><td style={{ textAlign: "right" }} className="small b">{Number.isFinite(r.amountPaise) ? formatINR(r.amountPaise) : "—"}</td>
              <td className="mono tiny">{r.utr ?? "—"}</td>
              <td className="tiny"><span className={`chip ${r.status === "matched" || r.status === "accepted" ? "c-active" : r.status === "invalid" ? "c-draft" : "c-pending"}`}>{LABEL[r.status] ?? r.status}</span>{r.message && <div className="muted">{r.message}</div>}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}
