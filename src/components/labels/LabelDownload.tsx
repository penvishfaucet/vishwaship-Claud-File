"use client";
import { useState } from "react";
import { Download, Printer, RotateCw } from "lucide-react";
import { type PrintFormat, PRINT_FORMATS, PRINT_HINT } from "@/lib/order-view";

export type FormatOption = { key: PrintFormat; name: string; ok: boolean; reason?: string };
type Skip = { shipmentId: string; orderNumber: string; reason: string; retryable: boolean };

/** Fetch a label PDF; returns what was skipped so the caller can offer Retry for just those. */
export async function fetchLabels(api: string, ids: string[], format: PrintFormat, win: Window | null) {
  const r = await fetch(`${api}?ids=${encodeURIComponent(ids.join(","))}&format=${format}`);
  if (!r.ok) {
    win?.close();
    const j = await r.json().catch(() => ({}));
    return { ok: false as const, message: (j.error?.message as string) ?? "Labels are not available", skipped: (j.skipped ?? []) as Skip[], notices: (j.notices ?? []) as string[], pages: 0 };
  }
  const parse = <T,>(h: string, d: T): T => { try { return JSON.parse(decodeURIComponent(r.headers.get(h) ?? "")) as T; } catch { return d; } };
  const url = URL.createObjectURL(await r.blob());
  if (win) win.location.href = url; else window.open(url, "_blank");
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
  return { ok: true as const, message: "", skipped: parse<Skip[]>("x-label-skipped", []), notices: parse<string[]>("x-label-notices", []), pages: Number(r.headers.get("x-label-pages") ?? 0) };
}

/**
 * Download Label with a print format picker (A4 2-up / 4-up, thermal sizes, Carrier label).
 * Pending or temporarily unavailable labels show the reason and a Retry button; Retry uses the same booking.
 */
export function LabelDownload({ ids, api = "/api/portal/labels", formats, defaultFormat, compact }: { ids: string[]; api?: string; formats?: FormatOption[]; defaultFormat?: PrintFormat; compact?: boolean }) {
  const opts: FormatOption[] = formats ?? PRINT_FORMATS.filter((p) => ["a4_4up", "thermal_4x6", "original"].includes(p.key)).map((p) => ({ key: p.key, name: p.name, ok: true }));
  const first = opts.find((o) => o.key === defaultFormat && o.ok) ?? opts.find((o) => o.ok);
  const [format, setFormat] = useState<PrintFormat>(first?.key ?? "thermal_4x6");
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<{ ok: boolean; text: string; retryIds: string[]; notices: string[] } | null>(null);
  async function go(which: string[]) {
    setBusy(true); setState(null);
    const w = window.open("about:blank", "_blank");
    try {
      const r = await fetchLabels(api, which, format, w);
      const retryIds = r.skipped.filter((s) => s.retryable).map((s) => s.shipmentId);
      const list = r.skipped.map((s) => `${s.orderNumber}: ${s.reason}`).join(" · ");
      setState(r.ok
        ? { ok: !r.skipped.length, text: r.skipped.length ? `${r.pages} page(s) ready. Not included — ${list}` : `${r.pages} page(s) ready.`, retryIds, notices: r.notices }
        : { ok: false, text: r.message, retryIds: r.skipped.length ? retryIds : which, notices: r.notices });
    } finally { setBusy(false); }
  }
  const sel = opts.find((o) => o.key === format);
  return (
    <div className={`lbl-dl${compact ? " compact" : ""}`}>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <label className="sr-only" htmlFor={`lf-${ids[0]}`}>Label format</label>
        <select id={`lf-${ids[0]}`} className="select" value={format} onChange={(e) => setFormat(e.target.value as PrintFormat)} style={{ maxWidth: 290 }}>
          <optgroup label="Label size">{opts.filter((o) => o.key !== "original").map((o) => <option key={o.key} value={o.key} disabled={!o.ok}>{o.name}{!o.ok ? " (unavailable)" : ""}</option>)}</optgroup>
          {opts.some((o) => o.key === "original") && <optgroup label="Courier's own label">{opts.filter((o) => o.key === "original").map((o) => <option key={o.key} value={o.key} disabled={!o.ok}>{o.name}{!o.ok ? " (unavailable)" : ""}</option>)}</optgroup>}
        </select>
        <button type="button" className="btn btn-orange" disabled={busy || !sel?.ok} onClick={() => void go(ids)}><Download size={16} aria-hidden /> {busy ? "Preparing…" : ids.length > 1 ? `Download ${ids.length} labels` : "Download Label"}</button>
      </div>
      {sel && !sel.ok && sel.reason && <p className="tiny muted" style={{ margin: "4px 0 0" }}>{sel.reason}</p>}
      <p className="tiny muted" style={{ margin: "4px 0 0" }}><Printer size={12} aria-hidden /> {PRINT_HINT}</p>
      {state && (
        <div className={`note small ${state.ok ? "" : "t-debit"}`} role={state.ok ? "status" : "alert"} style={{ marginTop: 6 }}>
          {state.text}
          {state.retryIds.length > 0 && <> <button type="button" className="btn btn-sm btn-outline" style={{ marginLeft: 6 }} disabled={busy} onClick={() => void go(state.retryIds)}><RotateCw size={13} aria-hidden /> Retry{state.retryIds.length > 1 ? ` ${state.retryIds.length}` : ""}</button></>}
          {state.notices.map((n) => <p key={n} className="tiny muted" style={{ margin: "4px 0 0" }}>{n}</p>)}
        </div>
      )}
    </div>
  );
}
