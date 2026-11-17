"use client";
import { useState } from "react";
import { LABEL_FORMATS } from "@/lib/org-settings";

type V = { format: string; showSellerAddress: boolean; showProducts: boolean; showCodAmount: boolean; showOrderValue: boolean; showSellerPhone: boolean; showLogo: boolean };
const TOGGLES: Array<[keyof V, string, string]> = [
  ["showSellerAddress", "Return / pickup address", "Shown on every label unless the courier prints its own"],
  ["showSellerPhone", "Seller phone", ""],
  ["showProducts", "Product names & quantity", "Hidden automatically on 2×4 in and 38×100 mm"],
  ["showCodAmount", "COD amount to collect", "Always printed for COD when the courier requires it"],
  ["showOrderValue", "Order / invoice value", ""],
  ["showLogo", "Your logo (from Invoice settings)", ""],
];

export function LabelSettings({ initial, carrierFormats }: { initial: V; carrierFormats: Record<string, string[]> }) {
  const [v, setV] = useState<V>(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [err, setErr] = useState("");
  const f = LABEL_FORMATS.find((x) => x.key === v.format) ?? LABEL_FORMATS[0];
  const small = v.format === "thermal_2x4" || v.format === "thermal_38x100";
  const unsupported = Object.entries(carrierFormats).filter(([, fs]) => !fs.includes(v.format)).map(([c]) => c);
  const set = <K extends keyof V>(k: K, x: V[K]) => { setV((o) => ({ ...o, [k]: x })); setState("idle"); };
  async function save() {
    setState("saving");
    const r = await fetch("/api/portal/settings/label_settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(v) });
    if (r.ok) setState("saved"); else { setState("error"); setErr((await r.json().catch(() => ({}))).error?.message ?? "Could not save"); }
  }
  // preview box scaled to the format's aspect ratio
  const toMm = (s: string) => (s.endsWith("in") ? parseFloat(s) * 25.4 : parseFloat(s));
  const ratio = toMm(f.h) / toMm(f.w);
  const W = 200;
  return (
    <div className="split" style={{ gap: 16, alignItems: "start" }}>
      <section className="card" style={{ padding: 18 }}>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="b small mb8">Label size</legend>
          <div className="grid2" style={{ gap: 8 }}>
            {LABEL_FORMATS.map((x) => (
              <label key={x.key} className={`card check small${v.format === x.key ? " on" : ""}`} style={{ padding: 10, borderColor: v.format === x.key ? "var(--orange)" : undefined }}>
                <input type="radio" name="fmt" checked={v.format === x.key} onChange={() => set("format", x.key)} /> {x.name}
              </label>
            ))}
          </div>
        </fieldset>
        {unsupported.length > 0 && <p className="small mt8 t-debit">Not offered by {unsupported.join(", ")} — those labels download in 4×6 in instead.</p>}
        <fieldset style={{ border: 0, padding: 0, margin: "16px 0 0" }}>
          <legend className="b small mb8">Optional content</legend>
          {TOGGLES.map(([k, l, h]) => (
            <label key={k} className="check small" style={{ display: "flex", gap: 8, marginBottom: 6 }}>
              <input type="checkbox" checked={!!v[k]} onChange={(e) => set(k, e.target.checked as never)} />
              <span>{l}{h && <span className="tiny muted" style={{ display: "block" }}>{h}</span>}</span>
            </label>
          ))}
        </fieldset>
        <p className="tiny muted">AWB barcode, routing code, destination address, and courier-mandated fields are always printed and cannot be turned off.</p>
        <div className="row mt12" style={{ gap: 10, alignItems: "center" }}>
          <button type="button" className="btn btn-orange" disabled={state === "saving"} onClick={save}>{state === "saving" ? "Saving…" : "Save as default"}</button>
          {state === "saved" && <span className="small t-credit" role="status">Saved. New label downloads use {f.name}.</span>}
          {state === "error" && <span className="small t-debit" role="alert">{err}</span>}
        </div>
      </section>
      <section className="card" style={{ padding: 18 }} aria-label="Label preview">
        <b className="small">Preview — {f.name}</b>
        <div style={{ margin: "12px auto 0", width: W, height: Math.round(W * ratio), border: "1px solid #000", background: "#fff", color: "#000", padding: small ? 4 : 8, fontSize: small ? 7 : 9, lineHeight: 1.3, display: "flex", flexDirection: "column", gap: 4, overflow: "hidden" }}>
          <div className="row between" style={{ fontWeight: 700 }}><span>Delhivery · Surface</span>{v.showLogo && <span style={{ border: "1px dashed #999", padding: "0 4px" }}>LOGO</span>}</div>
          <div style={{ height: small ? 22 : 34, background: "repeating-linear-gradient(90deg,#000 0 2px,#fff 2px 3px,#000 3px 4px,#fff 4px 6px)" }} aria-label="AWB barcode" />
          <div style={{ textAlign: "center", fontWeight: 700 }}>AWB 1234567890123 · DEL/MUM</div>
          <div><b>Ship to:</b> Ravi Kumar, 12 MG Road, Mumbai 400001 · 98XXXXXX10</div>
          {v.showCodAmount && <div style={{ fontWeight: 700 }}>COD: ₹1,499</div>}
          {v.showOrderValue && <div>Order value: ₹1,499</div>}
          {v.showProducts && !small && <div>Kurta × 1</div>}
          {v.showSellerAddress && <div style={{ marginTop: "auto" }}><b>Return:</b> Main warehouse, New Delhi 110034{v.showSellerPhone ? " · 98XXXXXX01" : ""}</div>}
        </div>
      </section>
    </div>
  );
}
