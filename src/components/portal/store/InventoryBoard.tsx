"use client";
import { Download, History, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api, mediaSrc } from "./ui";

export type InvItem = {
  key: string; productId: string; variantId: string | null; title: string; variantTitle: string | null; sku: string | null; image: string | null;
  available: number; reserved: number; damaged: number; onHand: number; reorderAt: number; unitCostPaise: number | null; low: boolean;
};
export type ReturnItem = { id: string; number: string; kind: string; buyer: string; lines: Array<{ title: string; variantTitle: string | null; sku: string | null; qty: number }> };
type Move = { label: string; available: number; reserved: number; damaged: number; reason: string | null; unitCostPaise: number | null; at: string; actor: string | null; order: string | null; orderId: string | null };
type Tab = "receipt" | "count" | "damage" | "write_off" | "repair" | "settings" | "history";

const rs = (p: number | null) => (p === null ? "—" : `₹${(p / 100).toLocaleString("en-IN", { minimumFractionDigits: p % 100 ? 2 : 0, maximumFractionDigits: 2 })}`);
const toPaise = (s: string) => (s.trim() === "" ? null : Math.round(Number(s) * 100));
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/** Inventory on a phone: one card per item, a sheet for receive / count / damaged / cost, stock history, returns to count, CSV. */
const EXTRA_INPUTS = [["packagingPaise", "Packaging"], ["labourPaise", "Labour"], ["otherPaise", "Other"], ["overheadPaise", "Overheads"]] as const;

/** Same per-piece costs for every product at once (e.g. ₹12 packaging on everything). Blank = keep each product's value. */
function BulkExtras({ onDone }: { onDone: (msg: string) => void }) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!open) return <button type="button" className="btn btn-soft btn-sm" style={{ justifySelf: "start" }} onClick={() => setOpen(true)}>Set packaging / per-piece costs for all products</button>;
  async function save() {
    const extras = Object.fromEntries(Object.entries(v).filter(([, x]) => x.trim() !== "").map(([k, x]) => [k, Math.round(Number(x) * 100)]));
    if (!Object.keys(extras).length) { setErr("Fill at least one amount"); return; }
    if (!window.confirm("Apply these per-piece costs to every product in the store?")) return;
    setBusy(true); setErr(null);
    const r = await api<{ products: number }>("POST", "/api/portal/store/inventory", { action: "extras_all", extras });
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    setOpen(false); setV({}); onDone(`Per-piece costs updated on ${r.data.products} product(s).`);
  }
  return (
    <div className="row wrap" style={{ gap: 8, alignItems: "end" }}>
      {EXTRA_INPUTS.map(([k, label]) => (
        <div className="field" key={k} style={{ width: 120 }}><label htmlFor={`bx-${k}`}>{label} (₹)</label>
          <input id={`bx-${k}`} className="input" inputMode="decimal" value={v[k] ?? ""} placeholder="keep" onChange={(e) => setV({ ...v, [k]: e.target.value.replace(/[^0-9.]/g, "") })} /></div>
      ))}
      <button type="button" className="btn btn-orange btn-sm" disabled={busy} onClick={save}>{busy ? "Saving…" : "Apply to all products"}</button>
      <button type="button" className="btn btn-outline btn-sm" onClick={() => setOpen(false)}>Cancel</button>
      {err && <span className="small red" role="alert">{err}</span>}
    </div>
  );
}

export function InventoryBoard({ rows, returns }: { rows: InvItem[]; returns: ReturnItem[] }) {
  const router = useRouter();
  const dlg = useRef<HTMLDialogElement>(null);
  const [it, setIt] = useState<InvItem | null>(null);
  const [tab, setTab] = useState<Tab>("receipt");
  const [f, setF] = useState({ qty: "", cost: "", reason: "", reorder: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; err?: string } | null>(null);
  const [moves, setMoves] = useState<Move[] | null>(null);

  function open(i: InvItem, t: Tab = "receipt") {
    setIt(i); setTab(t); setMsg(null); setMoves(null);
    setF({ qty: t === "count" ? String(i.available) : "", cost: i.unitCostPaise === null ? "" : String(i.unitCostPaise / 100), reason: "", reorder: String(i.reorderAt) });
    dlg.current?.showModal();
    if (t === "history") void loadHistory(i);
  }
  async function loadHistory(i: InvItem) {
    const r = await api<{ moves: Move[] }>("GET", `/api/portal/store/inventory?productId=${i.productId}&variantId=${i.variantId ?? ""}`);
    setMoves(r.ok ? r.data.moves : []);
  }
  function switchTab(t: Tab) { setTab(t); setMsg(null); if (t === "count" && it) setF((x) => ({ ...x, qty: String(it.available) })); if (t === "history" && it && !moves) void loadHistory(it); }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!it) return;
    setBusy(true); setMsg(null);
    const r = tab === "settings"
      ? await api("POST", "/api/portal/store/inventory", { action: "item", productId: it.productId, variantId: it.variantId, unitCostPaise: toPaise(f.cost), reorderAt: Number(f.reorder) || 0 })
      : await api("POST", "/api/portal/store/inventory", { action: "adjust", productId: it.productId, variantId: it.variantId, kind: tab, qty: Number(f.qty) || 0, unitCostPaise: tab === "receipt" ? toPaise(f.cost) : null, reason: f.reason });
    setBusy(false);
    if (!r.ok) { setMsg({ err: r.error }); return; }
    dlg.current?.close();
    router.refresh();
  }

  const reasonNeeded = tab === "count" || tab === "damage" || tab === "write_off";
  return (
    <>
      <CsvTools />
      {returns.length > 0 && <Returns items={returns} />}

      {rows.length === 0 ? <div className="card"><p className="muted" style={{ padding: 24, textAlign: "center", margin: 0 }}>No items here.</p></div> : (
        <>
          <div className="card p0 only-desktop" style={{ overflowX: "auto" }}>
            <table className="os-dns">
              <thead><tr><th>Item</th><th>SKU</th><th style={{ textAlign: "right" }}>Available</th><th style={{ textAlign: "right" }}>Held</th><th style={{ textAlign: "right" }}>On hand</th><th style={{ textAlign: "right" }}>Damaged</th><th style={{ textAlign: "right" }}>Reorder at</th><th style={{ textAlign: "right" }}>Unit cost</th><th /></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.key} className={r.available <= 0 ? "so-overdue" : undefined}>
                  <td>{r.title}{r.variantTitle && <span className="muted"> ({r.variantTitle})</span>}</td>
                  <td className="small mono">{r.sku ?? "—"}</td>
                  <td style={{ textAlign: "right", fontWeight: 600, color: r.available <= 0 ? "#b42318" : r.low ? "#c2410c" : undefined }}>{r.available}</td>
                  <td style={{ textAlign: "right" }}>{r.reserved}</td><td style={{ textAlign: "right" }}>{r.onHand}</td><td style={{ textAlign: "right" }}>{r.damaged || "—"}</td>
                  <td style={{ textAlign: "right" }}>{r.reorderAt}</td>
                  <td style={{ textAlign: "right" }}>{r.unitCostPaise === null ? <span className="tiny red">missing</span> : rs(r.unitCostPaise)}</td>
                  <td style={{ whiteSpace: "nowrap" }}><button className="btn btn-outline btn-sm" onClick={() => open(r)}>Update</button> <button className="btn btn-outline btn-sm" onClick={() => open(r, "history")} aria-label={`Stock history of ${r.title}`}><History size={14} aria-hidden /></button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <ul className="so-cards only-mobile">
            {rows.map((r) => (
              <li key={r.key} className="card so-card">
                <div className="inv-card">
                  {r.image ? <img src={mediaSrc(r.image)} alt="" width={52} height={52} loading="lazy" /> : <span className="inv-ph" aria-hidden />}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <b style={{ overflowWrap: "anywhere" }}>{r.title}</b>{r.variantTitle && <span className="muted"> ({r.variantTitle})</span>}
                    <div className="tiny muted mono">{r.sku ?? "no SKU"}</div>
                  </div>
                </div>
                <dl className="inv-nums">
                  <div><dt>Available</dt><dd style={{ color: r.available <= 0 ? "#b42318" : r.low ? "#c2410c" : undefined }}>{r.available}</dd></div>
                  <div><dt>Held</dt><dd>{r.reserved}</dd></div>
                  <div><dt>Damaged</dt><dd>{r.damaged}</dd></div>
                  <div><dt>Cost</dt><dd className={r.unitCostPaise === null ? "red" : ""}>{r.unitCostPaise === null ? "missing" : rs(r.unitCostPaise)}</dd></div>
                </dl>
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn btn-orange btn-sm" style={{ flex: 1, minHeight: 44 }} onClick={() => open(r)}>Update stock</button>
                  <button className="btn btn-outline btn-sm" style={{ minHeight: 44 }} onClick={() => open(r, "history")} aria-label={`Stock history of ${r.title}`}><History size={16} aria-hidden /></button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <dialog ref={dlg} className="so-dialog" aria-labelledby="inv-h">
        {it && <div style={{ display: "grid", gap: 10 }}>
          <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
            <h3 id="inv-h" style={{ margin: 0, fontSize: 16, overflowWrap: "anywhere" }}>{it.title}{it.variantTitle ? ` (${it.variantTitle})` : ""}</h3>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => dlg.current?.close()}>Close</button>
          </div>
          <p className="small muted" style={{ margin: 0 }}>Available <b>{it.available}</b> · held for orders <b>{it.reserved}</b> · damaged <b>{it.damaged}</b></p>
          <div className="so-tabs" style={{ marginBottom: 0 }} role="tablist">
            {([["receipt", "Receive"], ["count", "Count"], ["damage", "Damaged"], ...(it.damaged ? [["write_off", "Write off"], ["repair", "Repaired"]] : []), ["settings", "Cost & reorder"], ["history", "History"]] as Array<[Tab, string]>)
              .map(([k, l]) => <a key={k} role="tab" aria-selected={tab === k} href="#" className={tab === k ? "on" : ""} onClick={(e) => { e.preventDefault(); switchTab(k); }}>{l}</a>)}
          </div>
          {tab === "history" ? (
            moves === null ? <p className="small muted">Loading…</p> : moves.length === 0 ? <p className="small muted">No changes recorded yet.</p> : (
              <ul className="inv-moves">{moves.map((m, i) => (
                <li key={i}><div><b>{m.label}</b>{m.order && <> · <a className="orange" href={`/portal/store/orders/${m.orderId}/`}>{m.order}</a></>}{m.reason && <span className="muted"> · {m.reason}</span>}
                  <div className="tiny muted">{new Date(m.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}{m.actor ? ` · ${m.actor}` : ""}{m.unitCostPaise !== null ? ` · cost ${rs(m.unitCostPaise)}` : ""}</div></div>
                  <span className="mono small" style={{ textAlign: "right" }}>{m.available ? `${signed(m.available)} avl` : ""}{m.reserved ? ` ${signed(m.reserved)} held` : ""}{m.damaged ? ` ${signed(m.damaged)} dmg` : ""}</span></li>
              ))}</ul>
            )
          ) : (
            <form onSubmit={save} style={{ display: "grid", gap: 10 }}>
              {tab === "settings" ? (
                <div className="grid2">
                  <div className="field"><label htmlFor="inv-c">Unit cost (₹)</label><input id="inv-c" className="input" inputMode="decimal" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value.replace(/[^0-9.]/g, "") })} placeholder="What you pay per piece" />
                    <span className="tiny muted">Used for profit from now on; shipped orders keep their cost.</span></div>
                  <div className="field"><label htmlFor="inv-r">Low-stock alert at</label><input id="inv-r" className="input" inputMode="numeric" value={f.reorder} onChange={(e) => setF({ ...f, reorder: e.target.value.replace(/\D/g, "").slice(0, 6) })} /></div>
                </div>
              ) : (
                <>
                  <div className="field"><label htmlFor="inv-q">{tab === "count" ? "Pieces you counted on the shelf (sellable)" : tab === "receipt" ? "Pieces received" : "Pieces"}</label>
                    <input id="inv-q" className="input" inputMode="numeric" autoFocus value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value.replace(/\D/g, "").slice(0, 7) })} />
                    {tab === "count" && f.qty !== "" && <span className="small">{Number(f.qty) - it.available === 0 ? "No change" : `Change: ${signed(Number(f.qty) - it.available)}`} (pieces held for orders are not counted here)</span>}</div>
                  {tab === "receipt" && <div className="field"><label htmlFor="inv-c2">Price paid per piece (₹, optional)</label><input id="inv-c2" className="input" inputMode="decimal" value={f.cost} onChange={(e) => setF({ ...f, cost: e.target.value.replace(/[^0-9.]/g, "") })} /><span className="tiny muted">Unit cost becomes the average of old and new stock.</span></div>}
                  <div className="field"><label htmlFor="inv-why">Note{reasonNeeded ? <span className="req"> *</span> : " (optional)"}</label>
                    <input id="inv-why" className="input" maxLength={200} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder={tab === "receipt" ? "Bill / supplier" : tab === "count" ? "e.g. monthly stock check" : "What happened"} required={reasonNeeded} minLength={reasonNeeded ? 3 : 0} /></div>
                </>
              )}
              {msg?.err && <div className="err-box small" role="alert">{msg.err}</div>}
              <button className="btn btn-orange" disabled={busy} style={{ minHeight: 46 }}>{busy ? "Saving…" : "Save"}</button>
            </form>
          )}
        </div>}
      </dialog>
    </>
  );
}

function CsvTools() {
  const router = useRouter();
  const file = useRef<HTMLInputElement>(null);
  const [text, setText] = useState<string | null>(null);
  const [plan, setPlan] = useState<{ rows: Array<{ row: number; sku: string; title: string; errors: string[] }>; valid: number; invalid: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; err?: string } | null>(null);
  async function pick(fl: File | undefined) {
    if (!fl) return;
    setMsg(null); setPlan(null);
    if (fl.size > 2_000_000) { setMsg({ err: "File is too big (2 MB max)" }); return; }
    const t = await fl.text(); setText(t);
    const r = await api<NonNullable<typeof plan>>("POST", "/api/portal/store/inventory/csv", { text: t });
    if (!r.ok) setMsg({ err: r.error }); else setPlan(r.data);
    if (file.current) file.current.value = "";
  }
  async function apply() {
    if (!text) return;
    setBusy(true);
    const r = await api<{ changed: number; skipped: number }>("POST", "/api/portal/store/inventory/csv", { text, apply: true });
    setBusy(false);
    if (!r.ok) { setMsg({ err: r.error }); return; }
    setPlan(null); setText(null); setMsg({ ok: `${r.data.changed} item(s) updated${r.data.skipped ? `, ${r.data.skipped} row(s) skipped` : ""}.` });
    router.refresh();
  }
  return (
    <div className="card mb12" style={{ padding: 12, display: "grid", gap: 8 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        <a className="btn btn-outline btn-sm" href="/api/portal/store/inventory/csv" download><Download size={14} aria-hidden /> Export CSV</a>
        <button type="button" className="btn btn-outline btn-sm" onClick={() => file.current?.click()}><Upload size={14} aria-hidden /> Import CSV</button>
        <input ref={file} type="file" accept=".csv,text/csv" hidden onChange={(e) => void pick(e.target.files?.[0])} />
        <span className="tiny muted" style={{ alignSelf: "center" }}>Columns: sku, available, unit_cost, reorder_level, packaging_cost, labour_cost, other_cost, overhead_cost (blank = no change)</span>
      </div>
      <BulkExtras onDone={(t) => { setMsg({ ok: t }); router.refresh(); }} />
      {plan && (
        <div className="small">
          <b>{plan.valid} row(s) ready</b>{plan.invalid ? <span className="red">, {plan.invalid} with problems (skipped)</span> : null}
          {plan.invalid > 0 && <ul style={{ margin: "6px 0", paddingLeft: 18, maxHeight: 180, overflow: "auto" }}>{plan.rows.filter((r) => r.errors.length).slice(0, 100).map((r) => <li key={r.row}>Row {r.row}{r.sku ? ` (${r.sku})` : ""}: {r.errors.join("; ")}</li>)}</ul>}
          <div className="row" style={{ gap: 8, marginTop: 6 }}>
            <button className="btn btn-orange btn-sm" disabled={busy || !plan.valid} onClick={apply}>{busy ? "Updating…" : `Update ${plan.valid} item(s)`}</button>
            <button className="btn btn-outline btn-sm" onClick={() => { setPlan(null); setText(null); }}>Cancel</button>
          </div>
        </div>
      )}
      {msg?.err && <div className="err-box small" role="alert">{msg.err}</div>}
      {msg?.ok && <p className="small" role="status" style={{ margin: 0, color: "var(--green, #15803d)" }}>{msg.ok}</p>}
    </div>
  );
}

function Returns({ items }: { items: ReturnItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [counts, setCounts] = useState<Array<{ sellable: number; damaged: number; missing: number }>>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const cur = items.find((x) => x.id === open);
  function start(r: ReturnItem) { setOpen(r.id); setErr(""); setNote(""); setCounts(r.lines.map((l) => ({ sellable: l.qty, damaged: 0, missing: 0 }))); }
  const setC = (i: number, k: "sellable" | "damaged" | "missing", v: number) => setCounts((c) => c.map((x, j) => (j === i ? { ...x, [k]: Math.max(0, v) } : x)));
  async function save() {
    if (!cur) return;
    setBusy(true); setErr("");
    const r = await api("POST", "/api/portal/store/inventory/returns", { orderId: cur.id, lines: counts, note });
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    setOpen(null); router.refresh();
  }
  return (
    <div className="card mb12" style={{ padding: 12 }}>
      <b className="small">Returns to count ({items.length})</b>
      <p className="tiny muted" style={{ margin: "2px 0 8px" }}>Goods that came back (RTO). Check each piece: sellable ones go back on sale, damaged ones are set aside. Counted once per order.</p>
      <ul className="dp-files">
        {items.map((r) => (
          <li key={r.id} style={{ display: "block" }}>
            <div className="row" style={{ justifyContent: "space-between", gap: 8, alignItems: "center" }}>
              <span className="small"><a className="orange" href={`/portal/store/orders/${r.id}/`}><b>{r.number}</b></a> · {r.kind} · {r.buyer}</span>
              {open !== r.id && <button className="btn btn-outline btn-sm" onClick={() => start(r)}>Count return</button>}
            </div>
            {open === r.id && cur && (
              <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                {cur.lines.map((l, i) => (
                  <div key={i} className="inv-ret">
                    <div className="small" style={{ overflowWrap: "anywhere" }}><b>{l.title}</b>{l.variantTitle ? ` (${l.variantTitle})` : ""} · sent {l.qty}</div>
                    <div className="row" style={{ gap: 6 }}>
                      {(["sellable", "damaged", "missing"] as const).map((k) => (
                        <label key={k} className="field" style={{ flex: 1, minWidth: 0 }}><span className="tiny muted" style={{ textTransform: "capitalize" }}>{k}</span>
                          <input className="input" inputMode="numeric" value={String(counts[i]?.[k] ?? 0)} onChange={(e) => setC(i, k, Number(e.target.value.replace(/\D/g, "") || 0))} /></label>
                      ))}
                    </div>
                    {(counts[i]?.sellable ?? 0) + (counts[i]?.damaged ?? 0) + (counts[i]?.missing ?? 0) !== l.qty && <span className="tiny red">Must add up to {l.qty}</span>}
                  </div>
                ))}
                <input className="input" placeholder="Note (optional)" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
                {err && <div className="err-box small" role="alert">{err}</div>}
                <div className="row" style={{ gap: 8 }}>
                  <button className="btn btn-orange btn-sm" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save count"}</button>
                  <button className="btn btn-outline btn-sm" onClick={() => setOpen(null)}>Cancel</button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
