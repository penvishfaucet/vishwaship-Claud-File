"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

async function post<T>(body: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const r = await fetch("/api/admin/rto-charges/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  return r.ok ? { ok: true, data: j as T } : { ok: false, error: j?.error?.message ?? `Request failed (${r.status})` };
}
const paise = (s: string) => Math.round((Number(s.replace(/[₹,\s]/g, "")) || 0) * 100);

/** Confirm or adjust one RTO charge (source + reference, or a reason for a staff adjustment). */
export function ConfirmRto({ shipmentId, estimatePaise, canWrite }: { shipmentId: string; estimatePaise: number; canWrite: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ final: String(estimatePaise / 100), gst: "", other: "", credit: "", source: "carrier_invoice", reference: "", reason: "", wallet: true });
  const [msg, setMsg] = useState("");
  if (!canWrite) return null;
  if (!open) return <button type="button" className="btn btn-outline btn-sm" onClick={() => setOpen(true)}>Set charge</button>;
  async function save(e: React.FormEvent) {
    e.preventDefault(); setMsg("");
    const r = await post<{ state: string; walletDeltaPaise: number }>({ action: "confirm", shipmentId, finalPaise: paise(f.final), gstPaise: paise(f.gst), otherPaise: paise(f.other), creditsPaise: paise(f.credit), source: f.source, reference: f.reference, reason: f.reason, chargeWallet: f.wallet });
    if (!r.ok) { setMsg(r.error); return; }
    setOpen(false); router.refresh();
  }
  const set = (k: keyof typeof f, v: string | boolean) => setF({ ...f, [k]: v });
  return (
    <form onSubmit={save} style={{ display: "grid", gap: 6, minWidth: 260 }}>
      <div className="row wrap" style={{ gap: 6 }}>
        <input className="input" style={{ width: 100 }} inputMode="decimal" aria-label="Final RTO charge incl. GST (₹)" placeholder="Charge ₹" value={f.final} onChange={(e) => set("final", e.target.value)} />
        <input className="input" style={{ width: 80 }} inputMode="decimal" aria-label="GST in it (₹)" placeholder="GST ₹" value={f.gst} onChange={(e) => set("gst", e.target.value)} />
        <input className="input" style={{ width: 80 }} inputMode="decimal" aria-label="Other reverse charges (₹)" placeholder="Other ₹" value={f.other} onChange={(e) => set("other", e.target.value)} />
        <input className="input" style={{ width: 80 }} inputMode="decimal" aria-label="Credit (₹)" placeholder="Credit ₹" value={f.credit} onChange={(e) => set("credit", e.target.value)} />
      </div>
      <div className="row wrap" style={{ gap: 6 }}>
        <select className="input select" aria-label="Source" value={f.source} onChange={(e) => set("source", e.target.value)}>
          <option value="carrier_invoice">Carrier invoice</option><option value="settlement_file">Settlement file</option><option value="integration">Integration</option><option value="staff_adjustment">Staff adjustment</option>
        </select>
        <input className="input" style={{ flex: 1, minWidth: 120 }} aria-label="Reference" placeholder={f.source === "staff_adjustment" ? "Reason (required)" : "Invoice / file reference"} value={f.source === "staff_adjustment" ? f.reason : f.reference} onChange={(e) => set(f.source === "staff_adjustment" ? "reason" : "reference", e.target.value)} />
      </div>
      <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={f.wallet} onChange={(e) => set("wallet", e.target.checked)} /> Settle the difference in the customer&apos;s wallet</label>
      {msg && <span className="small red" role="alert">{msg}</span>}
      <div className="row" style={{ gap: 6 }}><button className="btn btn-orange btn-sm">Save</button><button type="button" className="btn btn-outline btn-sm" onClick={() => setOpen(false)}>Cancel</button></div>
    </form>
  );
}

/** Carrier settlement file: preview problems per row, then apply the good rows. */
export function ImportRto() {
  const router = useRouter();
  const file = useRef<HTMLInputElement>(null);
  const [text, setText] = useState<string | null>(null);
  const [plan, setPlan] = useState<{ rows: Array<{ row: number; awb: string; errors: string[] }>; valid: number; failed?: string[] } | null>(null);
  const [wallet, setWallet] = useState(true);
  const [msg, setMsg] = useState("");
  async function pick(f?: File) {
    if (!f) return; setMsg(""); const t = await f.text(); setText(t);
    const r = await post<NonNullable<typeof plan>>({ action: "import", text: t, apply: false });
    if (file.current) file.current.value = "";
    if (!r.ok) setMsg(r.error); else setPlan(r.data);
  }
  async function apply() {
    if (!text) return;
    const r = await post<NonNullable<typeof plan>>({ action: "import", text, apply: true, chargeWallet: wallet });
    if (!r.ok) { setMsg(r.error); return; }
    setMsg(`${r.data.valid} charge(s) saved${r.data.failed?.length ? `; not saved: ${r.data.failed.join("; ")}` : ""}`); setPlan(null); setText(null); router.refresh();
  }
  return (
    <div className="card" style={{ padding: 12, display: "grid", gap: 8 }}>
      <b className="small">Import a carrier RTO settlement (CSV: awb, rto_charge, gst, other, credit, reference)</b>
      <div className="row wrap" style={{ gap: 8, alignItems: "center" }}>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => file.current?.click()}>Choose file</button>
        <input ref={file} type="file" accept=".csv,text/csv" hidden onChange={(e) => void pick(e.target.files?.[0])} />
        <label className="row small" style={{ gap: 6 }}><input type="checkbox" checked={wallet} onChange={(e) => setWallet(e.target.checked)} /> Settle differences in wallets</label>
      </div>
      {plan && <div className="small">
        <b>{plan.valid} row(s) ready</b>
        <ul style={{ margin: "4px 0", paddingLeft: 18, maxHeight: 160, overflow: "auto" }}>{plan.rows.filter((r) => r.errors.length).map((r) => <li key={r.row} className="red">Row {r.row} {r.awb}: {r.errors.join("; ")}</li>)}</ul>
        <button className="btn btn-orange btn-sm" disabled={!plan.valid} onClick={apply}>Save {plan.valid} charge(s)</button>
      </div>}
      {msg && <p className="small" role="status" style={{ margin: 0 }}>{msg}</p>}
    </div>
  );
}

export function ResolveCod({ id, canWrite }: { id: string; canWrite: boolean }) {
  const router = useRouter();
  const [v, setV] = useState("");
  const [msg, setMsg] = useState("");
  if (!canWrite) return null;
  return (
    <form className="row wrap" style={{ gap: 6 }} onSubmit={async (e) => { e.preventDefault(); const r = await post({ action: "resolve_cod", id, resolution: v }); if (!r.ok) setMsg(r.error); else router.refresh(); }}>
      <input className="input" style={{ flex: 1, minWidth: 200 }} value={v} onChange={(e) => setV(e.target.value)} placeholder="Answer for the customer" aria-label="Answer" />
      <button className="btn btn-outline btn-sm">Answer</button>{msg && <span className="small red">{msg}</span>}
    </form>
  );
}
