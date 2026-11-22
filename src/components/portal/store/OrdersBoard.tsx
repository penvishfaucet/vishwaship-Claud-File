"use client";
import { Check, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "./ui";

export type BoardRow = {
  id: string; number: string; createdAt: string; stage: string; stageLabel: string; buyer: string; place: string; items: number; totalPaise: number;
  method: "cod" | "prepaid"; payLabel: string; payTone: "ok" | "warn" | "bad"; overdue: boolean; awb: string | null; refundLabel: string | null;
};
type Result = { id: string; number: string; ok: boolean; message: string; refund?: string | null };

const rs = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { minimumFractionDigits: p % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const STAGE_TONE: Record<string, string> = { pending_acceptance: "c-draft", to_pack: "c-draft", ready_to_ship: "c-active", delivered: "c-active", rejected: "c-cancelled", cancelled: "c-cancelled", rto: "c-cancelled", rto_delivered: "c-cancelled", lost: "c-cancelled", payment_failed: "c-cancelled", ndr: "c-cancelled" };
const PAY_TONE = { ok: "c-active", warn: "c-draft", bad: "c-cancelled" } as const;
const QUICK_REASONS = ["Out of stock", "Address not serviceable", "Duplicate order", "Buyer asked to cancel", "Suspected fake order"];

/**
 * Orders list for phone and desktop. Phones get cards; desktops get a table. Rows can be selected (kept while the
 * merchant opens an order and comes back) and accepted / rejected together; each order reports its own result.
 */
export function OrdersBoard({ rows, tab, selectable }: { rows: BoardRow[]; tab: string; selectable: boolean }) {
  const router = useRouter();
  const key = `vs-store-sel:${tab}`;
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);
  const [error, setError] = useState("");
  const [reason, setReason] = useState("");
  const dlg = useRef<HTMLDialogElement>(null);
  const [rejectIds, setRejectIds] = useState<string[]>([]);

  // keep the selection while the merchant opens an order and comes back (only ids still on this page)
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) ?? "[]") as string[];
      const here = new Set(rows.map((r) => r.id));
      setSel(new Set(saved.filter((id) => here.has(id))));
    } catch { /* private mode: start empty */ }
  }, [key, rows]);
  const save = (s: Set<string>) => { setSel(s); try { sessionStorage.setItem(key, JSON.stringify([...s])); } catch { /* ignore */ } };
  const toggle = (id: string) => { const s = new Set(sel); if (s.has(id)) s.delete(id); else s.add(id); save(s); };
  const allOn = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const toggleAll = () => save(allOn ? new Set() : new Set(rows.map((r) => r.id)));
  const pendingSel = useMemo(() => rows.filter((r) => sel.has(r.id) && r.stage === "pending_acceptance").map((r) => r.id), [rows, sel]);

  async function bulk(action: "accept" | "reject", ids: string[], why = "") {
    if (!ids.length) return;
    setBusy(action); setError(""); setResults(null);
    const r = await api<{ results: Result[] }>("POST", "/api/portal/store/orders/bulk", { action, ids, reason: why });
    setBusy(null);
    if (!r.ok) { setError(r.error); return; }
    setResults(r.data.results);
    const done = new Set(r.data.results.filter((x) => x.ok).map((x) => x.id));
    save(new Set([...sel].filter((id) => !done.has(id))));
    router.refresh();
  }
  function openReject(ids: string[]) { setRejectIds(ids); setReason(""); dlg.current?.showModal(); }
  async function confirmReject(e: React.FormEvent) {
    e.preventDefault();
    if (reason.trim().length < 3) return;
    dlg.current?.close();
    await bulk("reject", rejectIds, reason.trim());
  }

  const okN = results?.filter((r) => r.ok).length ?? 0;
  return (
    <>
      {results && (
        <div className="card mb12" role="status" style={{ padding: 12 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <b className="small">{okN} done{results.length - okN ? `, ${results.length - okN} not done` : ""}</b>
            <button className="btn btn-outline btn-sm" onClick={() => setResults(null)} aria-label="Close results">Close</button>
          </div>
          <ul className="small" style={{ margin: "8px 0 0", paddingLeft: 18, display: "grid", gap: 3 }}>
            {results.map((r) => <li key={r.id} style={{ color: r.ok ? undefined : "var(--red, #b42318)" }}><b>{r.number}</b>: {r.message}{r.refund ? ` · refund ${r.refund === "processed" ? "done" : r.refund === "failed" ? "failed — refund by hand" : "in progress"}` : ""}</li>)}
          </ul>
        </div>
      )}
      {error && <div className="err-box small mb12" role="alert">{error}</div>}

      {rows.length === 0 ? <div className="card"><p className="muted" style={{ padding: 24, textAlign: "center", margin: 0 }}>No orders here.</p></div> : (
        <>
          {/* desktop */}
          <div className="card p0 only-desktop" style={{ overflowX: "auto" }}>
            <table className="os-dns so-table">
              <thead><tr>
                {selectable && <th style={{ width: 34 }}><input type="checkbox" checked={allOn} onChange={toggleAll} aria-label="Select all orders on this page" /></th>}
                <th>Order</th><th>Date</th><th>Buyer</th><th>Items</th><th>Total</th><th>Payment</th><th>Status</th><th>Action</th>
              </tr></thead>
              <tbody>{rows.map((o) => (
                <tr key={o.id} className={o.overdue ? "so-overdue" : undefined}>
                  {selectable && <td><input type="checkbox" checked={sel.has(o.id)} onChange={() => toggle(o.id)} aria-label={`Select order ${o.number}`} /></td>}
                  <td><a className="orange" style={{ fontWeight: 600 }} href={`/portal/store/orders/${o.id}/`}>{o.number}</a>{o.overdue && <div className="tiny red">Waiting too long</div>}</td>
                  <td className="small">{when(o.createdAt)}</td>
                  <td className="small">{o.buyer}<div className="tiny muted">{o.place}</div></td>
                  <td className="small">{o.items}</td>
                  <td>{rs(o.totalPaise)}<div className="tiny muted">{o.method === "cod" ? "COD" : "Prepaid"}</div></td>
                  <td><span className={`chip ${PAY_TONE[o.payTone]}`}>{o.payLabel}</span>{o.refundLabel && <div className="tiny muted">{o.refundLabel}</div>}</td>
                  <td><span className={`chip ${STAGE_TONE[o.stage] ?? "c-active"}`}>{o.stageLabel}</span>{o.awb && <div className="tiny muted mono">{o.awb}</div>}</td>
                  <td><NextAction o={o} busy={busy} onAccept={() => bulk("accept", [o.id])} onReject={() => openReject([o.id])} /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>

          {/* phone */}
          <div className="only-mobile">
            {selectable && <label className="row small so-selall" style={{ gap: 8, alignItems: "center" }}><input type="checkbox" checked={allOn} onChange={toggleAll} /> Select all on this page</label>}
            <ul className="so-cards">
              {rows.map((o) => (
                <li key={o.id} className={`card so-card${o.overdue ? " so-overdue" : ""}${sel.has(o.id) ? " so-on" : ""}`}>
                  <div className="so-card-h">
                    {selectable && <input type="checkbox" className="so-check" checked={sel.has(o.id)} onChange={() => toggle(o.id)} aria-label={`Select order ${o.number}`} />}
                    <a href={`/portal/store/orders/${o.id}/`} className="so-card-link">
                      <span className="so-num">{o.number}</span>
                      <span className="tiny muted">{when(o.createdAt)}</span>
                    </a>
                    <span className={`chip ${STAGE_TONE[o.stage] ?? "c-active"}`}>{o.stageLabel}</span>
                  </div>
                  <a href={`/portal/store/orders/${o.id}/`} className="so-card-b">
                    <span><b>{rs(o.totalPaise)}</b> · {o.method === "cod" ? "COD" : "Prepaid"} · {o.items} item{o.items === 1 ? "" : "s"}</span>
                    <span className="small muted">{o.buyer} · {o.place}</span>
                    {(o.payTone !== "ok" || o.refundLabel) && <span className="small">{o.payLabel}{o.refundLabel ? ` · ${o.refundLabel}` : ""}</span>}
                    {o.awb && <span className="tiny muted mono">AWB {o.awb}</span>}
                    {o.overdue && <span className="tiny red">Waiting too long for acceptance</span>}
                  </a>
                  {o.stage === "pending_acceptance" && <div className="so-card-a"><NextAction o={o} busy={busy} onAccept={() => bulk("accept", [o.id])} onReject={() => openReject([o.id])} /></div>}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {selectable && sel.size > 0 && (
        <div className="so-bulk" role="region" aria-label="Actions for selected orders">
          <span className="small"><b>{sel.size}</b> selected</span>
          <div className="row" style={{ gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {pendingSel.length > 0 && <>
              <button className="btn btn-orange btn-sm" disabled={!!busy} onClick={() => bulk("accept", pendingSel)}>{busy === "accept" ? "Accepting…" : `Accept ${pendingSel.length}`}</button>
              <button className="btn btn-outline btn-sm" disabled={!!busy} onClick={() => openReject(pendingSel)}>Reject {pendingSel.length}</button>
            </>}
            <button className="btn btn-outline btn-sm" onClick={() => save(new Set())}>Clear</button>
          </div>
        </div>
      )}

      <dialog ref={dlg} className="so-dialog" aria-labelledby="rej-h">
        <form onSubmit={confirmReject} style={{ display: "grid", gap: 10 }}>
          <h3 id="rej-h" style={{ margin: 0, fontSize: 16 }}>Reject {rejectIds.length === 1 ? "this order" : `${rejectIds.length} orders`}?</h3>
          <p className="small muted" style={{ margin: 0 }}>Stock goes back to your store. Prepaid orders are refunded to the buyer through your payment gateway. The buyer is told by email when they gave one.</p>
          <div className="row wrap" style={{ gap: 6 }}>{QUICK_REASONS.map((q) => <button type="button" key={q} className={`btn btn-sm ${reason === q ? "btn-orange" : "btn-outline"}`} onClick={() => setReason(q)}>{q}</button>)}</div>
          <div className="field"><label htmlFor="rej-r">Reason <span className="req">*</span></label>
            <textarea id="rej-r" className="input" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} required minLength={3} /></div>
          <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
            <button type="button" className="btn btn-outline" onClick={() => dlg.current?.close()}>Keep order</button>
            <button className="btn btn-orange" disabled={reason.trim().length < 3}>Reject</button>
          </div>
        </form>
      </dialog>
    </>
  );
}

function NextAction({ o, busy, onAccept, onReject }: { o: BoardRow; busy: string | null; onAccept: () => void; onReject: () => void }) {
  if (o.stage === "pending_acceptance") return (
    <div className="row" style={{ gap: 6 }}>
      <button className="btn btn-orange btn-sm" disabled={!!busy} onClick={onAccept}><Check size={14} aria-hidden /> Accept</button>
      <button className="btn btn-outline btn-sm" disabled={!!busy} onClick={onReject}><X size={14} aria-hidden /> Reject</button>
    </div>
  );
  if (o.stage === "to_pack") return <a className="btn btn-outline btn-sm" href="/portal/store/dispatch/?view=all">Pack & ship</a>;
  return <a className="small orange" href={`/portal/store/orders/${o.id}/`}>View</a>;
}
