"use client";
import { Boxes, FileDown, Printer, Share2, Truck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, mediaSrc } from "./ui";

export type ProcessItem = {
  id: string; number: string; at: string; dispatchBy: string; delayed: boolean; duplicateOf: string | null; step: "print" | "pack" | "handover";
  product: { title: string; sku: string | null; qty: number; image: string | null }; moreItems: number; items: number;
  cod: boolean; totalPaise: number; payLabel: string; buyer: string; place: string; carrier: string | null; awb: string | null; handedOver: boolean; awbAgeDays: number | null;
  shippingOrderId: string | null; stageLabel: string;
};
type Result = { id: string; number: string; ok: boolean; message: string; awb: string | null; carrier: string | null; booked: boolean; codHold?: boolean };
type FileLink = { label: string; url: string; at: number };
type CourierOpt = { key: string; carrierName: string; serviceName: string; orders: number; totalPaise: number; cheapestFor: number };
type Options = { considered: number; cheapestTotal: number; options: CourierOpt[]; skipped: string[] };

const rs = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { minimumFractionDigits: p % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const FORMATS = [{ key: "a4_4up", label: "A4 · 4 per page" }, { key: "thermal_4x6", label: "Thermal 4 × 6" }];
const FILES_KEY = "vs-store-files";

/** Process Orders list with the step's actions: Print labels → Mark packed → Handover (+ manifest), for selected rows or one row. */
export function ProcessBoard({ rows, tab, step, warehouseId, today }: { rows: ProcessItem[]; tab: string; step: string; warehouseId: string | null; today: string }) {
  const router = useRouter();
  const selKey = `vs-proc:${tab}:${step}`;
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [format, setFormat] = useState("a4_4up");
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);
  const [note, setNote] = useState<{ ok?: string; err?: string } | null>(null);
  const [files, setFiles] = useState<FileLink[]>([]);
  /** courier for booking: "cheapest" (auto, lowest rate), "rules" (my Auto-Assign rules) or one courier "code|service" */
  const [courier, setCourier] = useState("cheapest");
  const [opts, setOpts] = useState<Options | null>(null);
  const actionable = tab === "pending";

  useEffect(() => {
    try {
      const here = new Set(rows.map((r) => r.id));
      setSel(new Set((JSON.parse(sessionStorage.getItem(selKey) ?? "[]") as string[]).filter((id) => here.has(id))));
      setFormat(localStorage.getItem("vs-label-format") ?? "a4_4up");
      const c = localStorage.getItem("vs-store-courier-mode");
      if (c === "rules" || c === "cheapest") setCourier(c);
      setFiles((JSON.parse(sessionStorage.getItem(FILES_KEY) ?? "[]") as FileLink[]).filter((f) => Date.now() - f.at < 12 * 3600_000));
    } catch { /* storage blocked */ }
  }, [rows, selKey]);
  const save = (s: Set<string>) => { setSel(s); try { sessionStorage.setItem(selKey, JSON.stringify([...s])); } catch { /* ignore */ } };
  const toggle = (id: string) => { const s = new Set(sel); if (s.has(id)) s.delete(id); else s.add(id); save(s); };
  const allOn = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const ids = rows.filter((r) => sel.has(r.id)).map((r) => r.id);
  const addFile = (label: string, url: string) => setFiles((cur) => {
    const next = [{ label, url, at: Date.now() }, ...cur.filter((f) => f.url !== url)].slice(0, 8);
    try { sessionStorage.setItem(FILES_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });
  const pickMode = (c: string) => { setCourier(c); if (c === "rules" || c === "cheapest") { setOpts(null); try { localStorage.setItem("vs-store-courier-mode", c); } catch { /* ignore */ } } };
  async function loadOptions(list: string[]) {
    if (!list.length) return;
    setBusy("options"); setNote(null);
    const r = await api<Options>("POST", "/api/portal/store/dispatch", { action: "options", ids: list.slice(0, 50) });
    setBusy(null);
    if (!r.ok) { setNote({ err: r.error }); return; }
    setOpts(r.data);
    if (!r.data.options.length) setNote({ err: "No courier serves these orders right now." });
    else setCourier(r.data.options[0].key);
  }
  const pickFormat = (f: string) => { setFormat(f); try { localStorage.setItem("vs-label-format", f); } catch { /* ignore */ } };

  async function labelsFor(shipmentIds: string[]) {
    if (!shipmentIds.length) return;
    const url = `/api/portal/labels?ids=${shipmentIds.join(",")}&format=${format}`;
    const r = await fetch(url);
    if (!r.ok) { const j = await r.json().catch(() => ({})); setNote({ err: j?.error?.message ?? "Labels are not ready yet. Try again in a minute." }); return; }
    const skipped = JSON.parse(decodeURIComponent(r.headers.get("x-label-skipped") ?? "%5B%5D")) as Array<{ orderNumber: string; reason: string }>;
    if (skipped.length) setNote({ err: `Not in this PDF (try again later): ${skipped.map((s) => `${s.orderNumber}: ${s.reason}`).join("; ")}` });
    addFile(`Labels · ${shipmentIds.length} · ${FORMATS.find((f) => f.key === format)?.label ?? ""}`, url);
    window.open(url, "_blank", "noopener");
  }
  async function print(list: string[], skipCod: string[] = []) {
    if (!list.length) return;
    setBusy("print"); setNote(null); setResults(null);
    const r = await api<{ results: Result[]; shipmentIds: string[] }>("POST", "/api/portal/store/dispatch", { action: "print", ids: list, shipWithoutCodConfirmation: skipCod, courier });
    if (!r.ok) { setBusy(null); setNote({ err: r.error }); return; }
    setResults(r.data.results);
    await labelsFor(r.data.shipmentIds);
    setBusy(null);
    const done = new Set(r.data.results.filter((x) => x.ok).map((x) => x.id));
    save(new Set([...sel].filter((id) => !done.has(id))));
    router.refresh();
  }
  async function reprint(list: string[]) {
    setBusy("labels"); setNote(null);
    const r = await api<{ shipmentIds: string[] }>("POST", "/api/portal/store/dispatch", { action: "labels", ids: list });
    if (!r.ok) setNote({ err: r.error }); else await labelsFor(r.data.shipmentIds);
    setBusy(null);
  }
  async function mark(action: "mark_packed" | "handover", list: string[]) {
    if (!list.length) return;
    setBusy(action); setNote(null);
    const r = await api<{ packed?: string[]; skipped?: string[]; handedOver?: string[] }>("POST", "/api/portal/store/dispatch", { action, ids: list });
    setBusy(null);
    if (!r.ok) { setNote({ err: r.error }); return; }
    setNote({ ok: action === "mark_packed" ? `${r.data.packed?.length ?? 0} packed${r.data.skipped?.length ? `; print the label first for ${r.data.skipped.join(", ")}` : ""}.` : `${r.data.handedOver?.length ?? 0} handed over. They leave this list when the courier scans the pickup.` });
    save(new Set()); router.refresh();
  }
  function doc(kind: "slips" | "picklist", list: string[]) {
    if (!list.length) return;
    const url = `/api/portal/store/dispatch/${kind}?ids=${list.join(",")}`;
    addFile(`${kind === "slips" ? "Packing slips" : "Pick list"} · ${list.length}`, url);
    window.open(url, "_blank", "noopener");
  }
  async function manifest() {
    setBusy("manifest"); setNote(null);
    const r = await api<{ pdfUrl: string; awbCount: number; manifestNo: string }>("POST", "/api/portal/manifests", { date: today, warehouseId: warehouseId ?? "" });
    setBusy(null);
    if (!r.ok) { setNote({ err: r.error }); return; }
    addFile(`Manifest ${r.data.manifestNo} · ${r.data.awbCount} AWB`, r.data.pdfUrl);
    window.open(r.data.pdfUrl, "_blank", "noopener");
  }
  async function share(f: FileLink) {
    try {
      const blob = await (await fetch(f.url)).blob();
      const file = new File([blob], `${f.label.replace(/[^A-Za-z0-9]+/g, "-").slice(0, 60)}.pdf`, { type: "application/pdf" });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: f.label }); else window.open(f.url, "_blank", "noopener");
    } catch { /* closed */ }
  }

  const codWaiting = results?.filter((r) => !r.ok && r.codHold) ?? [];
  const otherFailed = results?.filter((r) => !r.ok && !r.codHold) ?? [];
  const list = ids.length ? ids : rows.map((r) => r.id);
  const action = (o: ProcessItem) => {
    if (tab === "expired") return o.shippingOrderId ? <a className="btn btn-outline btn-sm" href={`/portal/orders/${o.shippingOrderId}/`}>Cancel &amp; re-book</a> : null;
    if (!actionable) return <a className="small orange" href={`/portal/store/orders/${o.id}/`}>View</a>;
    if (o.step === "print") return <button className="btn btn-orange btn-sm" disabled={!!busy} onClick={() => print([o.id])}><Printer size={14} aria-hidden /> Print label</button>;
    if (o.step === "pack") return <div className="row" style={{ gap: 6 }}><button className="btn btn-orange btn-sm" disabled={!!busy} onClick={() => mark("mark_packed", [o.id])}><Boxes size={14} aria-hidden /> Packed</button><button className="btn btn-outline btn-sm" disabled={!!busy} onClick={() => reprint([o.id])} aria-label={`Reprint label of ${o.number}`}><Printer size={14} aria-hidden /></button></div>;
    return o.handedOver ? <span className="tiny muted">Handed over · waiting for pickup scan</span>
      : <div className="row" style={{ gap: 6 }}><button className="btn btn-orange btn-sm" disabled={!!busy} onClick={() => mark("handover", [o.id])}><Truck size={14} aria-hidden /> Handed over</button><button className="btn btn-outline btn-sm" disabled={!!busy} onClick={() => reprint([o.id])} aria-label={`Reprint label of ${o.number}`}><Printer size={14} aria-hidden /></button></div>;
  };

  return (
    <>
      {actionable && (
        <div className="card mb12 dp-tools">
          <div className="row wrap" style={{ gap: 8, alignItems: "center" }}>
            {step === "print" && <><span className="small muted">Label size</span>
              <div className="seg" role="radiogroup" aria-label="Label size">{FORMATS.map((f) => <button key={f.key} type="button" role="radio" aria-checked={format === f.key} className={format === f.key ? "on" : ""} onClick={() => pickFormat(f.key)}>{f.label}</button>)}</div>
              <span className="small muted">Courier</span>
              <div className="seg" role="radiogroup" aria-label="Courier">
                <button type="button" role="radio" aria-checked={courier === "cheapest"} className={courier === "cheapest" ? "on" : ""} onClick={() => pickMode("cheapest")}>Auto · cheapest</button>
                <button type="button" role="radio" aria-checked={courier === "rules"} className={courier === "rules" ? "on" : ""} onClick={() => pickMode("rules")}>My auto-assign rules</button>
                <button type="button" role="radio" aria-checked={courier !== "rules" && courier !== "cheapest"} className={courier !== "rules" && courier !== "cheapest" ? "on" : ""} disabled={!rows.length || !!busy} onClick={() => loadOptions(list)}>{busy === "options" ? "Checking rates…" : "Choose courier"}</button>
              </div></>}
            <div className="row wrap" style={{ gap: 8, marginLeft: "auto" }}>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => doc("slips", list)} disabled={!rows.length}><FileDown size={14} aria-hidden /> Packing slip{ids.length ? ` (${ids.length})` : "s (all)"}</button>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => doc("picklist", list)} disabled={!rows.length}>Pick list</button>
              {step === "print" && <button type="button" className="btn btn-orange btn-sm" disabled={!rows.length || !!busy} onClick={() => print(list)}><Printer size={14} aria-hidden /> {busy === "print" ? "Booking & printing…" : ids.length ? `Print ${ids.length} label${ids.length === 1 ? "" : "s"}` : "Print all"}</button>}
              {step === "pack" && <button type="button" className="btn btn-orange btn-sm" disabled={!rows.length || !!busy} onClick={() => mark("mark_packed", list)}><Boxes size={14} aria-hidden /> {ids.length ? `Mark ${ids.length} packed` : "Mark all packed"}</button>}
              {step === "handover" && <>
                <button type="button" className="btn btn-outline btn-sm" disabled={!!busy} onClick={manifest}><Truck size={14} aria-hidden /> {busy === "manifest" ? "Making…" : "Today's manifest"}</button>
                <button type="button" className="btn btn-orange btn-sm" disabled={!rows.length || !!busy} onClick={() => mark("handover", list)}>{ids.length ? `Hand over ${ids.length}` : "Hand over all"}</button>
              </>}
            </div>
          </div>
          {step === "print" && opts && opts.options.length > 0 && courier !== "rules" && courier !== "cheapest" && (
            <div className="dp-couriers mt8" role="radiogroup" aria-label="Choose the courier for these orders">
              <p className="tiny muted" style={{ margin: "0 0 6px" }}>Rates for {opts.considered} order{opts.considered === 1 ? "" : "s"}{ids.length ? " (selected)" : " (all on this list)"}. Auto · cheapest would cost {rs(opts.cheapestTotal)} in total.{opts.skipped.length ? ` Not included: ${opts.skipped.join("; ")}.` : ""}</p>
              {opts.options.map((o) => (
                <label key={o.key} className={`dp-courier${courier === o.key ? " on" : ""}`}>
                  <input type="radio" name="dp-courier" checked={courier === o.key} onChange={() => setCourier(o.key)} />
                  <span className="dp-c-name"><b>{o.carrierName}</b><span className="tiny muted">{o.serviceName}</span></span>
                  <span className="dp-c-cov tiny">{o.orders === opts.considered ? "All orders" : `${o.orders} of ${opts.considered} orders`}{o.cheapestFor ? ` · cheapest for ${o.cheapestFor}` : ""}</span>
                  <b className="dp-c-amt">{rs(o.totalPaise)}</b>
                </label>
              ))}
              <p className="tiny muted" style={{ margin: "6px 0 0" }}>Orders this courier does not serve are not booked; they stay here with a message so you can pick another courier for them.</p>
            </div>
          )}
        </div>
      )}

      {results && (
        <div className="card mb12" role="status" style={{ padding: 12 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <b className="small">{results.filter((r) => r.ok).length} label(s) ready{otherFailed.length + codWaiting.length ? `, ${otherFailed.length + codWaiting.length} not done` : ""}</b>
            <div className="row" style={{ gap: 6 }}>
              {otherFailed.length > 0 && <button className="btn btn-orange btn-sm" disabled={!!busy} onClick={() => print(otherFailed.map((f) => f.id))}>Retry {otherFailed.length} failed</button>}
              <button className="btn btn-outline btn-sm" onClick={() => setResults(null)}>Close</button>
            </div>
          </div>
          <ul className="small" style={{ margin: "8px 0 0", paddingLeft: 18, display: "grid", gap: 3 }}>
            {results.map((r) => <li key={r.id} style={{ color: r.ok ? undefined : "var(--red, #b42318)" }}><b>{r.number}</b>: {r.message}{r.awb ? ` · ${r.carrier ?? ""} ${r.awb}` : ""}</li>)}
          </ul>
          {codWaiting.length > 0 && (
            <div className="note small" style={{ marginTop: 10, display: "grid", gap: 8 }}>
              <span><b>{codWaiting.length} COD order{codWaiting.length === 1 ? " is" : "s are"} waiting for the buyer&apos;s reply on WhatsApp.</b> Wait, or ship now if you are sure about the buyer.</span>
              <div><button type="button" className="btn btn-outline btn-sm" disabled={!!busy} onClick={() => {
                if (!confirm(`Ship ${codWaiting.map((r) => r.number).join(", ")} without the buyer's WhatsApp confirmation?\n\nThe buyer has not confirmed, so the risk of RTO is higher. This is recorded as your decision.`)) return;
                void print(codWaiting.map((r) => r.id), codWaiting.map((r) => r.id));
              }}>Ship without confirmation &amp; print label{codWaiting.length === 1 ? "" : "s"}</button></div>
            </div>
          )}
        </div>
      )}
      {note?.err && <div className="err-box small mb12" role="alert">{note.err}</div>}
      {note?.ok && <p className="note small mb12" role="status">{note.ok}</p>}
      {files.length > 0 && (
        <details className="card mb12" style={{ padding: "6px 12px" }}>
          <summary className="small" style={{ cursor: "pointer", minHeight: 34, display: "flex", alignItems: "center" }}>Your files ({files.length})</summary>
          <ul className="dp-files" style={{ marginBottom: 8 }}>
            {files.map((f) => <li key={f.url}><span className="small" style={{ minWidth: 0, overflowWrap: "anywhere" }}>{f.label}</span>
              <span className="row" style={{ gap: 6, flexShrink: 0 }}><a className="btn btn-outline btn-sm" href={f.url} target="_blank" rel="noopener">Open</a><button type="button" className="btn btn-outline btn-sm" onClick={() => share(f)} aria-label={`Share ${f.label}`}><Share2 size={14} aria-hidden /></button></span></li>)}
          </ul>
        </details>
      )}

      {rows.length === 0 ? <div className="card"><div className="po-empty"><Boxes size={42} aria-hidden /><b>No orders here</b><span className="small muted">There is nothing in this view right now.</span></div></div> : (
        <>
          <div className="card p0 only-desktop" style={{ overflowX: "auto" }}>
            <table className="os-dns po-table">
              <thead><tr>
                {actionable && <th style={{ width: 34 }}><input type="checkbox" checked={allOn} onChange={() => save(allOn ? new Set() : new Set(rows.map((r) => r.id)))} aria-label="Select all" /></th>}
                <th>Order ({rows.length})</th><th>Product</th><th>Payment</th><th>Customer</th><th>Shipping</th><th>Dispatch &amp; delivery</th><th>Action</th>
              </tr></thead>
              <tbody>{rows.map((o) => (
                <tr key={o.id} className={o.delayed && actionable ? "so-overdue" : undefined}>
                  {actionable && <td><input type="checkbox" checked={sel.has(o.id)} onChange={() => toggle(o.id)} aria-label={`Select order ${o.number}`} /></td>}
                  <td><a className="orange" style={{ fontWeight: 600 }} href={`/portal/store/orders/${o.id}/`}>{o.number}</a><div className="tiny muted">{o.at}</div>
                    {o.duplicateOf && <div className="tiny red">Possible duplicate of {o.duplicateOf}</div>}</td>
                  <td><div className="po-prod">{o.product.image ? <img src={mediaSrc(o.product.image)} alt="" width={40} height={40} loading="lazy" /> : <span className="inv-ph" style={{ width: 40, height: 40 }} aria-hidden />}
                    <span className="small"><span className="po-clamp">{o.product.title}</span><span className="tiny muted mono">{o.product.sku ?? "no SKU"} · qty {o.product.qty}</span>{o.moreItems > 0 && <span className="tiny orange">+{o.moreItems} more item{o.moreItems === 1 ? "" : "s"}</span>}</span></div></td>
                  <td className="small"><b>{rs(o.totalPaise)}</b><div className="tiny muted">{o.cod ? "COD" : "Prepaid"} · {o.payLabel}</div></td>
                  <td className="small">{o.buyer}<div className="tiny muted">{o.place}</div></td>
                  <td className="small">{o.carrier ?? <span className="muted">Not booked</span>}{o.awb && <div className="tiny muted mono">{o.awb}</div>}{tab === "expired" && o.awbAgeDays !== null && <div className="tiny red">Booked {o.awbAgeDays} days ago</div>}</td>
                  <td className="small"><span className={o.delayed ? "red" : ""}>Dispatch by {o.dispatchBy}</span>{o.delayed && <div className="tiny red">Delayed</div>}<div className="tiny muted">{o.stageLabel}</div></td>
                  <td>{action(o)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div className="only-mobile">
            {actionable && <label className="row small so-selall" style={{ gap: 8, alignItems: "center" }}><input type="checkbox" checked={allOn} onChange={() => save(allOn ? new Set() : new Set(rows.map((r) => r.id)))} /> Select all ({rows.length})</label>}
            <ul className="so-cards">
              {rows.map((o) => (
                <li key={o.id} className={`card so-card${o.delayed && actionable ? " so-overdue" : ""}${sel.has(o.id) ? " so-on" : ""}`}>
                  <div className="so-card-h">
                    {actionable && <input type="checkbox" className="so-check" checked={sel.has(o.id)} onChange={() => toggle(o.id)} aria-label={`Select order ${o.number}`} />}
                    <a href={`/portal/store/orders/${o.id}/`} className="so-card-link"><span className="so-num">{o.number}</span><span className="tiny muted">{o.at}</span></a>
                    <span className={`chip ${o.delayed ? "c-cancelled" : "c-draft"}`}>{o.delayed ? "Delayed" : `By ${o.dispatchBy}`}</span>
                  </div>
                  <div className="po-prod" style={{ marginTop: 8 }}>{o.product.image ? <img src={mediaSrc(o.product.image)} alt="" width={44} height={44} loading="lazy" /> : <span className="inv-ph" style={{ width: 44, height: 44 }} aria-hidden />}
                    <span className="small"><span className="po-clamp">{o.product.title}</span><span className="tiny muted mono">{o.product.sku ?? "no SKU"} · qty {o.product.qty}{o.moreItems ? ` · +${o.moreItems} more` : ""}</span></span></div>
                  <div className="so-card-b"><span><b>{rs(o.totalPaise)}</b> · {o.cod ? "COD" : "Prepaid"} · {o.buyer} · {o.place}</span>
                    <span className="tiny muted mono">{o.carrier ? `${o.carrier}${o.awb ? ` · ${o.awb}` : ""}` : "Not booked yet"}</span>
                    {o.duplicateOf && <span className="tiny red">Possible duplicate of {o.duplicateOf}</span>}</div>
                  <div className="so-card-a">{action(o)}</div>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </>
  );
}
