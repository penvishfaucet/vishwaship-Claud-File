"use client";
import { FileDown, Package, Share2, Tags, Truck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "./ui";

export type DispatchRow = {
  id: string; number: string; at: string; stage: "to_pack" | "ready_to_ship"; buyer: string; place: string; items: number; lines: string;
  totalPaise: number; cod: boolean; packed: boolean; awb: string | null; carrier: string | null; overdue: boolean;
};
type Result = { id: string; number: string; ok: boolean; message: string; awb: string | null; carrier: string | null; booked: boolean; codHold?: boolean };
type FileLink = { label: string; url: string; at: number };

const rs = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { minimumFractionDigits: p % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const FORMATS = [{ key: "a4_4up", label: "A4 · 4 per page" }, { key: "thermal_4x6", label: "Thermal 4 × 6" }];
const FILES_KEY = "vs-store-files";

/**
 * Packing & Dispatch on a phone: pick orders, print slips / pick list, then "Pack & download labels" books a courier
 * where needed and makes one label PDF. Files stay listed under "Your files" (open or share again), and only the
 * orders that failed are offered for a retry.
 */
export function DispatchBoard({ rows, view, warehouseId, today }: { rows: DispatchRow[]; view: string; warehouseId: string | null; today: string }) {
  const router = useRouter();
  const selKey = `vs-store-dispatch:${view}`;
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [format, setFormat] = useState("a4_4up");
  const [busy, setBusy] = useState<string | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);
  const [error, setError] = useState("");
  const [files, setFiles] = useState<FileLink[]>([]);

  useEffect(() => {
    try {
      const here = new Set(rows.map((r) => r.id));
      setSel(new Set((JSON.parse(sessionStorage.getItem(selKey) ?? "[]") as string[]).filter((id) => here.has(id))));
      setFormat(localStorage.getItem("vs-label-format") ?? "a4_4up");
      setFiles((JSON.parse(sessionStorage.getItem(FILES_KEY) ?? "[]") as FileLink[]).filter((f) => Date.now() - f.at < 12 * 3600_000));
    } catch { /* storage blocked: start empty */ }
  }, [rows, selKey]);
  const save = (s: Set<string>) => { setSel(s); try { sessionStorage.setItem(selKey, JSON.stringify([...s])); } catch { /* ignore */ } };
  const toggle = (id: string) => { const s = new Set(sel); if (s.has(id)) s.delete(id); else s.add(id); save(s); };
  const allOn = rows.length > 0 && rows.every((r) => sel.has(r.id));
  const chosen = rows.filter((r) => sel.has(r.id));
  const ids = chosen.map((r) => r.id);
  const addFile = (label: string, url: string) => setFiles((cur) => {
    const next = [{ label, url, at: Date.now() }, ...cur.filter((f) => f.url !== url)].slice(0, 8);
    try { sessionStorage.setItem(FILES_KEY, JSON.stringify(next)); } catch { /* ignore */ }
    return next;
  });
  const pickFormat = (f: string) => { setFormat(f); try { localStorage.setItem("vs-label-format", f); } catch { /* ignore */ } };

  async function labelsFor(shipmentIds: string[], n: number) {
    if (!shipmentIds.length) return;
    const url = `/api/portal/labels?ids=${shipmentIds.join(",")}&format=${format}`;
    const r = await fetch(url, { method: "GET" });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      setError(j?.error?.message ?? "Labels are not ready yet. Try again in a minute.");
      return;
    }
    const skipped = JSON.parse(decodeURIComponent(r.headers.get("x-label-skipped") ?? "%5B%5D")) as Array<{ orderNumber: string; reason: string }>;
    if (skipped.length) setError(`Not in this PDF (try again later): ${skipped.map((s) => `${s.orderNumber}: ${s.reason}`).join("; ")}`);
    addFile(`Labels · ${n} order${n === 1 ? "" : "s"} · ${FORMATS.find((f) => f.key === format)?.label ?? ""}`, url);
  }

  async function packAndLabels(onlyIds = ids, shipWithoutCodConfirmation: string[] = []) {
    if (!onlyIds.length) return;
    setBusy("pack"); setError(""); setResults(null);
    const r = await api<{ results: Result[]; shipmentIds: string[] }>("POST", "/api/portal/store/dispatch", { action: "pack", ids: onlyIds, shipWithoutCodConfirmation });
    if (!r.ok) { setBusy(null); setError(r.error); return; }
    setResults(r.data.results);
    await labelsFor(r.data.shipmentIds, r.data.shipmentIds.length);
    setBusy(null);
    const done = new Set(r.data.results.filter((x) => x.ok).map((x) => x.id));
    save(new Set([...sel].filter((id) => !done.has(id))));
    router.refresh();
  }
  async function labelsOnly() {
    setBusy("labels"); setError("");
    const r = await api<{ shipmentIds: string[] }>("POST", "/api/portal/store/dispatch", { action: "labels", ids });
    if (!r.ok) setError(r.error);
    else if (!r.data.shipmentIds.length) setError("None of these orders has a booked courier yet. Use Pack & download labels.");
    else await labelsFor(r.data.shipmentIds, r.data.shipmentIds.length);
    setBusy(null);
  }
  function doc(kind: "slips" | "picklist") {
    const list = ids.length ? ids : rows.map((r) => r.id);
    if (!list.length) return;
    const url = `/api/portal/store/dispatch/${kind}?ids=${list.join(",")}`;
    addFile(`${kind === "slips" ? "Packing slips" : "Pick list"} · ${list.length} order${list.length === 1 ? "" : "s"}`, url);
    window.open(url, "_blank", "noopener");
  }
  async function manifest() {
    setBusy("manifest"); setError("");
    const r = await api<{ pdfUrl: string; awbCount: number; manifestNo: string }>("POST", "/api/portal/manifests", { date: today, warehouseId: warehouseId ?? "" });
    setBusy(null);
    if (!r.ok) { setError(r.error); return; }
    addFile(`Manifest ${r.data.manifestNo} · ${r.data.awbCount} AWB`, r.data.pdfUrl);
  }
  async function share(f: FileLink) {
    try {
      const blob = await (await fetch(f.url)).blob();
      const file = new File([blob], `${f.label.replace(/[^A-Za-z0-9]+/g, "-").slice(0, 60)}.pdf`, { type: "application/pdf" });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title: f.label });
      else window.open(f.url, "_blank", "noopener");
    } catch { /* share sheet closed */ }
  }

  const failed = results?.filter((r) => !r.ok) ?? [];
  const codWaiting = failed.filter((r) => r.codHold);
  function shipAnyway() {
    const list = codWaiting.map((r) => r.number).join(", ");
    if (!confirm(`Ship ${codWaiting.length === 1 ? "this COD order" : `these ${codWaiting.length} COD orders`} (${list}) without the buyer's WhatsApp confirmation?

The buyer has not confirmed yet, so the risk of RTO is higher. This is recorded as your decision.`)) return;
    void packAndLabels(codWaiting.map((r) => r.id), codWaiting.map((r) => r.id));
  }
  const okN = (results?.length ?? 0) - failed.length;
  return (
    <>
      <div className="card mb12 dp-tools">
        <div className="row wrap" style={{ gap: 8, alignItems: "center" }}>
          <span className="small muted">Label size</span>
          <div className="seg" role="radiogroup" aria-label="Label size">
            {FORMATS.map((f) => <button key={f.key} type="button" role="radio" aria-checked={format === f.key} className={format === f.key ? "on" : ""} onClick={() => pickFormat(f.key)}>{f.label}</button>)}
          </div>
          <button type="button" className="btn btn-outline btn-sm" onClick={manifest} disabled={!!busy} style={{ marginLeft: "auto" }}><Truck size={14} aria-hidden /> {busy === "manifest" ? "Making…" : "Today's manifest"}</button>
        </div>
        <div className="row wrap" style={{ gap: 8 }}>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => doc("slips")} disabled={!rows.length}><FileDown size={14} aria-hidden /> Packing slips{ids.length ? ` (${ids.length})` : " (all)"}</button>
          <button type="button" className="btn btn-outline btn-sm" onClick={() => doc("picklist")} disabled={!rows.length}><Tags size={14} aria-hidden /> Pick list{ids.length ? ` (${ids.length})` : " (all)"}</button>
        </div>
      </div>

      {results && (
        <div className="card mb12" role="status" style={{ padding: 12 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <b className="small">{okN} ready{failed.length ? `, ${failed.length} not done` : ""}</b>
            <div className="row" style={{ gap: 6 }}>
              {failed.length > codWaiting.length && <button className="btn btn-orange btn-sm" disabled={!!busy} onClick={() => packAndLabels(failed.filter((f) => !f.codHold).map((f) => f.id))}>Retry {failed.length - codWaiting.length} failed</button>}
              <button className="btn btn-outline btn-sm" onClick={() => setResults(null)}>Close</button>
            </div>
          </div>
          <ul className="small" style={{ margin: "8px 0 0", paddingLeft: 18, display: "grid", gap: 3 }}>
            {results.map((r) => <li key={r.id} style={{ color: r.ok ? undefined : "var(--red, #b42318)" }}><b>{r.number}</b>: {r.message}{r.awb ? ` · ${r.carrier ?? ""} ${r.awb}` : ""}</li>)}
          </ul>
          {codWaiting.length > 0 && (
            <div className="note small" style={{ marginTop: 10, display: "grid", gap: 8 }}>
              <span><b>{codWaiting.length} COD order{codWaiting.length === 1 ? " is" : "s are"} waiting for the buyer&apos;s reply on WhatsApp.</b> You can wait, or ship now if you are sure about the buyer (for example you spoke to them on the phone).</span>
              <div><button type="button" className="btn btn-outline btn-sm" disabled={!!busy} onClick={shipAnyway}>Ship without confirmation &amp; download label{codWaiting.length === 1 ? "" : "s"}</button></div>
            </div>
          )}
        </div>
      )}
      {error && <div className="err-box small mb12" role="alert">{error}</div>}

      {files.length > 0 && (
        <div className="card mb12" style={{ padding: 12 }}>
          <b className="small">Your files</b>
          <ul className="dp-files">
            {files.map((f) => (
              <li key={f.url}>
                <span className="small" style={{ minWidth: 0, overflowWrap: "anywhere" }}>{f.label}<span className="tiny muted"> · {new Date(f.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span></span>
                <span className="row" style={{ gap: 6, flexShrink: 0 }}>
                  <a className="btn btn-outline btn-sm" href={f.url} target="_blank" rel="noopener">Open</a>
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => share(f)} aria-label={`Share ${f.label}`}><Share2 size={14} aria-hidden /></button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {rows.length === 0 ? <div className="card"><p className="muted" style={{ padding: 24, textAlign: "center", margin: 0 }}>Nothing to pack here. New orders appear once you accept them.</p></div> : (
        <>
          <label className="row small so-selall" style={{ gap: 8, alignItems: "center" }}><input type="checkbox" checked={allOn} onChange={() => save(allOn ? new Set() : new Set(rows.map((r) => r.id)))} /> Select all ({rows.length})</label>
          <ul className="so-cards dp-grid">
            {rows.map((o) => (
              <li key={o.id} className={`card so-card${o.overdue ? " so-overdue" : ""}${sel.has(o.id) ? " so-on" : ""}`}>
                <div className="so-card-h">
                  <input type="checkbox" className="so-check" checked={sel.has(o.id)} onChange={() => toggle(o.id)} aria-label={`Select order ${o.number}`} />
                  <a href={`/portal/store/orders/${o.id}/`} className="so-card-link"><span className="so-num">{o.number}</span><span className="tiny muted">{o.at}</span></a>
                  <span className={`chip ${o.stage === "ready_to_ship" ? "c-active" : "c-draft"}`}>{o.stage === "ready_to_ship" ? "Ready to ship" : o.packed ? "Packed" : "To pack"}</span>
                </div>
                <div className="so-card-b">
                  <span><b>{rs(o.totalPaise)}</b> · {o.cod ? "COD" : "Prepaid"} · {o.items} item{o.items === 1 ? "" : "s"}</span>
                  <span className="small" style={{ overflowWrap: "anywhere" }}>{o.lines}</span>
                  <span className="small muted">{o.buyer} · {o.place}</span>
                  {o.awb && <span className="tiny muted mono">{o.carrier} · AWB {o.awb}</span>}
                  {o.overdue && <span className="tiny red">Accepted on an earlier day: pack first</span>}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {sel.size > 0 && (
        <div className="so-bulk" role="region" aria-label="Actions for selected orders">
          <span className="small"><b>{sel.size}</b> selected</span>
          <div className="row" style={{ gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {chosen.some((r) => r.stage === "ready_to_ship") && <button className="btn btn-outline btn-sm" disabled={!!busy} onClick={labelsOnly}>{busy === "labels" ? "Preparing…" : "Labels"}</button>}
            <button className="btn btn-orange btn-sm" disabled={!!busy} onClick={() => packAndLabels()}><Package size={14} aria-hidden /> {busy === "pack" ? "Booking & preparing…" : "Pack & download labels"}</button>
            <button className="btn btn-outline btn-sm" onClick={() => save(new Set())}>Clear</button>
          </div>
        </div>
      )}
    </>
  );
}
