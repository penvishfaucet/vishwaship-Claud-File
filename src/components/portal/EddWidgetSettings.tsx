"use client";
import { useState } from "react";

type V = { enabled: boolean; heading: string; buttonText: string; color: string; processingDays: number; cutoffHour: number; allowedOrigins: string[]; showCourier: boolean };

export function EddWidgetSettings({ initial, widgetKey, host }: { initial: V; widgetKey: string; host: string }) {
  const [v, setV] = useState<V>(initial);
  const [origins, setOrigins] = useState(initial.allowedOrigins.join("\n"));
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [err, setErr] = useState("");
  const [pin, setPin] = useState("");
  const [test, setTest] = useState("");
  const set = <K extends keyof V>(k: K, x: V[K]) => { setV((o) => ({ ...o, [k]: x })); setState("idle"); };
  const snippet = `<div data-vishwaship-edd="${widgetKey}" data-heading="${v.heading.replace(/"/g, "&quot;")}" data-button="${v.buttonText.replace(/"/g, "&quot;")}" data-color="${v.color}"></div>\n<script src="${host}/edd-widget.js" async></script>`;
  async function save() {
    setState("saving"); setErr("");
    const body = { ...v, allowedOrigins: origins.split(/\s+/).map((x) => x.trim()).filter(Boolean) };
    const r = await fetch("/api/portal/settings/edd_widget", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) setState("saved"); else { setState("error"); setErr((await r.json().catch(() => ({}))).error?.message ?? "Could not save"); }
  }
  async function check() {
    if (!/^[1-9]\d{5}$/.test(pin)) { setTest("Enter a valid 6-digit PIN code."); return; }
    setTest("Checking…");
    const r = await fetch(`/api/public/edd/?key=${widgetKey}&pin=${pin}`);
    const j = await r.json().catch(() => ({}));
    setTest(j.error ? j.error : j.serviceable ? `Delivery by ${new Date(`${j.date}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}${j.courier ? ` via ${j.courier}` : ""}` : "Not serviceable for this PIN code.");
  }
  return (
    <div className="split" style={{ gap: 16, alignItems: "start" }}>
      <section className="card" style={{ padding: 18 }}>
        <label className="check small mb12" style={{ display: "flex" }}><input type="checkbox" checked={v.enabled} onChange={(e) => set("enabled", e.target.checked)} /> <b style={{ marginLeft: 6 }}>Widget active</b></label>
        <div className="grid2" style={{ gap: 10 }}>
          <div className="field"><label htmlFor="eh">Heading</label><input id="eh" className="input" maxLength={60} value={v.heading} onChange={(e) => set("heading", e.target.value)} /></div>
          <div className="field"><label htmlFor="eb">Button text</label><input id="eb" className="input" maxLength={24} value={v.buttonText} onChange={(e) => set("buttonText", e.target.value)} /></div>
          <div className="field"><label htmlFor="ec">Button colour</label><input id="ec" type="color" className="input" style={{ height: 40 }} value={v.color} onChange={(e) => set("color", e.target.value)} /></div>
          <div className="field"><label htmlFor="ep">Processing days before dispatch</label><input id="ep" type="number" min={0} max={10} className="input" value={v.processingDays} onChange={(e) => set("processingDays", Number(e.target.value) || 0)} /></div>
          <div className="field"><label htmlFor="eo">Same-day cutoff (hour, IST)</label><input id="eo" type="number" min={0} max={23} className="input" value={v.cutoffHour} onChange={(e) => set("cutoffHour", Number(e.target.value) || 0)} /></div>
          <label className="check small" style={{ alignSelf: "end" }}><input type="checkbox" checked={v.showCourier} onChange={(e) => set("showCourier", e.target.checked)} /> Show courier name</label>
          <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="ea">Allowed store URLs (one per line; empty = any site)</label><textarea id="ea" className="input" rows={2} value={origins} placeholder="https://mystore.com" onChange={(e) => { setOrigins(e.target.value); setState("idle"); }} /></div>
        </div>
        <div className="row mt12" style={{ gap: 10, alignItems: "center" }}>
          <button type="button" className="btn btn-orange" disabled={state === "saving"} onClick={save}>{state === "saving" ? "Saving…" : "Save widget"}</button>
          {state === "saved" && <span className="small t-credit" role="status">Saved.</span>}
          {state === "error" && <span className="small t-debit" role="alert">{err}</span>}
        </div>
      </section>
      <section className="card" style={{ padding: 18 }}>
        <b className="small">Preview</b>
        <div className="mt8" style={{ border: "1px dashed var(--line)", borderRadius: 8, padding: 12, background: "#fff", color: "#111" }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>{v.heading}</div>
          <div className="row" style={{ gap: 6 }}><input className="input" style={{ width: 130 }} inputMode="numeric" maxLength={6} placeholder="PIN code" aria-label="Test PIN code" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} /><button type="button" className="btn" style={{ background: v.color, color: "#fff" }} onClick={check}>{v.buttonText}</button></div>
          <div className="small mt8" role="status">{test || (state !== "saved" && !initial.enabled ? "Save with “Widget active” on to test." : "")}</div>
        </div>
        <b className="small mt16" style={{ display: "block" }}>Embed code</b>
        <p className="tiny muted" style={{ margin: "4px 0" }}>Paste where the date should appear on your product page (Shopify: product template; WooCommerce: product page block).</p>
        <pre className="small" style={{ whiteSpace: "pre-wrap", wordBreak: "break-all", background: "var(--gray-soft)", padding: 10, borderRadius: 8 }}>{snippet}</pre>
        <button type="button" className="btn btn-sm btn-outline" onClick={() => navigator.clipboard?.writeText(snippet)}>Copy code</button>
      </section>
    </div>
  );
}
