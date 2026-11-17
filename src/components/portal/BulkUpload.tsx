"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { Upload } from "lucide-react";

type Row = { row: number; orderId: string; ok: boolean; errors: string[]; summary?: string };

export function BulkUpload({ warehouses }: { warehouses: Array<{ id: string; label: string }> }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [warehouseId, setWarehouseId] = useState(warehouses[0].id);
  const [preview, setPreview] = useState<{ total: number; valid: number; rows: Row[] } | null>(null);
  const [result, setResult] = useState<{ created: number; codHeld: number; skipped: number; failures: Array<{ row: number; orderId: string; error: string }> } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [onlyErrors, setOnlyErrors] = useState(false);

  async function send(mode: "preview" | "import") {
    const f = fileRef.current?.files?.[0];
    if (!f) { setErr("Choose a CSV or XLSX file."); return; }
    setBusy(true); setErr(null); if (mode === "preview") { setResult(null); setPreview(null); }
    const fd = new FormData(); fd.set("file", f); fd.set("warehouseId", warehouseId); fd.set("mode", mode);
    const r = await fetch("/api/portal/orders/bulk", { method: "POST", body: fd });
    const j = await r.json(); setBusy(false);
    if (!r.ok) { setErr(j.error?.message ?? "Upload failed"); return; }
    if (mode === "preview") setPreview(j); else { setResult(j); setPreview(null); }
  }

  const shown = preview ? (onlyErrors ? preview.rows.filter((r) => !r.ok) : preview.rows) : [];
  return (
    <>
      <section className="card" style={{ padding: 18 }}>
        <div className="grid3" style={{ gap: 12, alignItems: "end" }}>
          <div className="field"><label htmlFor="bw">Pickup address for all rows</label><select id="bw" className="select" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}</select></div>
          <div className="field"><label htmlFor="bf">File (CSV or XLSX, up to 1,000 rows)</label><input id="bf" ref={fileRef} type="file" accept=".csv,.xlsx" className="input" onChange={() => { setPreview(null); setResult(null); }} /></div>
          <button className="btn btn-orange" onClick={() => send("preview")} disabled={busy}><Upload size={16} /> {busy && !preview ? "Checking…" : "Upload & preview"}</button>
        </div>
        <p className="tiny muted mt8">One row per order. Rows are checked exactly like manual orders: PIN code, mobile, COD amount, package dimensions, e-way bill for B2B ≥ ₹50,000, and duplicate order IDs (in the file and in your account). Nothing is created until you confirm.</p>
        {err && <p className="err small" role="alert">{err}</p>}
      </section>

      {preview && (
        <section className="card p0 mt16" aria-live="polite">
          <div className="row between wrap card-h" style={{ gap: 8 }}>
            <b>{preview.valid} of {preview.total} rows ready{preview.total - preview.valid ? ` · ${preview.total - preview.valid} with errors` : ""}</b>
            <div className="row" style={{ gap: 8 }}>
              <label className="check small"><input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} /> Show only errors</label>
              <button className="btn btn-orange btn-sm" disabled={busy || preview.valid === 0} onClick={() => send("import")}>{busy ? "Importing…" : `Import ${preview.valid} order${preview.valid === 1 ? "" : "s"}`}</button>
            </div>
          </div>
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Row</th><th>Order ID</th><th>Details</th><th>Result</th></tr></thead>
            <tbody>{shown.map((r) => <tr key={r.row}><td>{r.row}</td><td className="mono small">{r.orderId || "—"}</td><td className="small">{r.summary}</td><td>{r.ok ? <span className="chip c-success">Ready</span> : <ul className="err tiny" style={{ margin: 0, paddingLeft: 16 }}>{r.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}</td></tr>)}</tbody></table></div>
          {preview.total - preview.valid > 0 && <p className="tiny muted" style={{ padding: "0 16px 12px" }}>Rows with errors are skipped. Fix them in your file and upload again — already-imported order IDs will show as duplicates.</p>}
        </section>
      )}

      {result && (
        <section className="card mt16" style={{ padding: 18 }} role="status">
          <b>{result.created} order{result.created === 1 ? "" : "s"} created</b>{result.codHeld ? ` · ${result.codHeld} waiting for COD confirmation` : ""}{result.skipped ? ` · ${result.skipped} skipped` : ""}
          {result.failures.length > 0 && <ul className="err small">{result.failures.map((f) => <li key={f.row}>Row {f.row} ({f.orderId}): {f.error}</li>)}</ul>}
          <div className="mt12"><Link className="btn btn-orange btn-sm" href="/portal/orders/?group=">View orders</Link></div>
          <p className="tiny muted mt8">Imported orders are ready to book from the order page (choose courier per order).</p>
        </section>
      )}
    </>
  );
}
