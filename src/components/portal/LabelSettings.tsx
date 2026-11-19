"use client";
import { useState } from "react";
import { LABEL_FORMATS } from "@/lib/org-settings";
import { PRINT_HINT } from "@/lib/order-view";

type V = { format: string; showSellerAddress: boolean; showProducts: boolean; showCodAmount: boolean; showOrderValue: boolean; showSellerPhone: boolean; showLogo: boolean };

/** Default label format. The Vishwaship label's fields are fixed (carrier and shipping rules), so only the size is chosen here. */
export function LabelSettings({ initial }: { initial: V; carrierFormats?: Record<string, string[]> }) {
  const [v, setV] = useState<V>(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [err, setErr] = useState("");
  const f = LABEL_FORMATS.find((x) => x.key === v.format) ?? LABEL_FORMATS[0];
  async function save() {
    setState("saving");
    const r = await fetch("/api/portal/settings/label_settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(v) });
    if (r.ok) setState("saved"); else { setState("error"); setErr((await r.json().catch(() => ({}))).error?.message ?? "Could not save"); }
  }
  return (
    <div className="split" style={{ gap: 16, alignItems: "start" }}>
      <section className="card" style={{ padding: 18 }}>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="b small mb8">Default label format</legend>
          <div className="grid2" style={{ gap: 8 }}>
            {LABEL_FORMATS.map((x) => (
              <label key={x.key} className={`card check small${v.format === x.key ? " on" : ""}`} style={{ padding: 10, borderColor: v.format === x.key ? "var(--orange)" : undefined }}>
                <input type="radio" name="fmt" checked={v.format === x.key} onChange={() => { setV((o) => ({ ...o, format: x.key })); setState("idle"); }} /> {x.name}
              </label>
            ))}
          </div>
        </fieldset>
        <p className="tiny muted mt8">{PRINT_HINT} You can pick another format each time you download.</p>
        <div className="row mt12" style={{ gap: 10, alignItems: "center" }}>
          <button type="button" className="btn btn-orange" disabled={state === "saving"} onClick={save}>{state === "saving" ? "Saving…" : "Save as default"}</button>
          {state === "saved" && <span className="small t-credit" role="status">Saved. New label downloads use {f.name}.</span>}
          {state === "error" && <span className="small t-debit" role="alert">{err}</span>}
        </div>
      </section>
      <section className="card" style={{ padding: 18 }} aria-label="What the Vishwaship label shows">
        <b className="small">What the Vishwaship label shows</b>
        <ul className="small" style={{ margin: "8px 0 0", paddingLeft: 18, display: "grid", gap: 4 }}>
          <li>Vishwaship logo, with the courier partner&apos;s logo</li>
          <li><b>DELIVER TO</b>: name, full address, large PIN, phone</li>
          <li>AWB / LRN barcode (the courier&apos;s own number) and carton barcode for each box</li>
          <li><b>SHIP FROM / PICKUP</b>: your company name, your GSTIN (from Invoice settings or profile), pickup address</li>
          <li>Order ID, invoice number, invoice value, product names, weight, carton count</li>
        </ul>
        <p className="tiny muted mt8">The COD amount is never printed on the Vishwaship label. The courier&apos;s own label (Carrier label) is unchanged and may show it where the courier requires.</p>
      </section>
    </div>
  );
}
