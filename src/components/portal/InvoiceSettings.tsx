"use client";
import { useMemo, useState } from "react";
import { INVOICE_CSS, type InvoiceLook, invoiceBodyHtml } from "@/lib/sales-invoice";

type V = Required<Pick<InvoiceLook, "businessName" | "gstin" | "address" | "phone" | "email" | "logo" | "prefix" | "footer" | "signatureText" | "showHsn" | "color">>;
const SAMPLE = {
  number: "1001", date: new Date().toLocaleDateString("en-IN"), consignee: { name: "Ravi Kumar", line1: "12 MG Road, Sector 4", city: "Mumbai", state: "Maharashtra", pincode: "400001" },
  items: [{ name: "Cotton kurta", qty: 2, unitPrice: 74950, hsn: "6211" }], payment: "Cash on delivery ₹1,499.00", shippedVia: "Delhivery AWB 1234567890",
};

export function InvoiceSettings({ initial }: { initial: V }) {
  const [v, setV] = useState<V>(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [err, setErr] = useState("");
  const set = <K extends keyof V>(k: K, x: V[K]) => { setV((o) => ({ ...o, [k]: x })); setState("idle"); };
  const preview = useMemo(() => invoiceBodyHtml(v, SAMPLE), [v]);
  async function onLogo(file?: File) {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { setErr("Logo must be PNG, JPG or WebP"); return; }
    if (file.size > 150_000) { setErr("Logo must be under 150 KB"); return; }
    const r = new FileReader(); r.onload = () => { set("logo", String(r.result)); setErr(""); }; r.readAsDataURL(file);
  }
  async function save() {
    setState("saving"); setErr("");
    const r = await fetch("/api/portal/settings/invoice_settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(v) });
    if (r.ok) setState("saved"); else { setState("error"); const j = await r.json().catch(() => ({})); setErr(j.error?.message ?? "Could not save"); }
  }
  const F = (k: keyof V, label: string, extra: Record<string, unknown> = {}) => (
    <div className="field"><label htmlFor={`iv-${k}`}>{label}</label><input id={`iv-${k}`} className="input" value={String(v[k] ?? "")} onChange={(e) => set(k, e.target.value as never)} {...extra} /></div>
  );
  return (
    <div className="split" style={{ gap: 16, alignItems: "start" }}>
      <section className="card" style={{ padding: 18 }}>
        <div className="grid2" style={{ gap: 10 }}>
          {F("businessName", "Business name *", { required: true, maxLength: 80 })}
          {F("gstin", "GSTIN", { maxLength: 15, placeholder: "22AAAAA0000A1Z5" })}
          <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="iv-address">Address</label><textarea id="iv-address" className="input" rows={2} value={v.address} maxLength={300} onChange={(e) => set("address", e.target.value)} /></div>
          {F("phone", "Phone", { maxLength: 20 })}
          {F("email", "Email", { type: "email", maxLength: 120 })}
          {F("prefix", "Invoice number prefix", { maxLength: 10 })}
          <div className="field"><label htmlFor="iv-color">Accent colour</label><input id="iv-color" type="color" className="input" value={v.color} onChange={(e) => set("color", e.target.value)} style={{ height: 40 }} /></div>
          <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="iv-logo">Logo (PNG/JPG/WebP, max 150 KB)</label><input id="iv-logo" type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => onLogo(e.target.files?.[0])} />{v.logo && <button type="button" className="btn btn-sm btn-outline mt8" onClick={() => set("logo", "")}>Remove logo</button>}</div>
          <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="iv-footer">Footer / terms</label><textarea id="iv-footer" className="input" rows={2} value={v.footer} maxLength={300} onChange={(e) => set("footer", e.target.value)} /></div>
          {F("signatureText", "Signature line", { maxLength: 60 })}
          <label className="check small" style={{ alignSelf: "end" }}><input type="checkbox" checked={v.showHsn} onChange={(e) => set("showHsn", e.target.checked)} /> Show HSN codes</label>
        </div>
        <div className="row mt12" style={{ gap: 10, alignItems: "center" }}>
          <button type="button" className="btn btn-orange" disabled={state === "saving" || v.businessName.trim().length < 2} onClick={save}>{state === "saving" ? "Saving…" : "Save invoice settings"}</button>
          {state === "saved" && <span className="small t-credit" role="status">Saved. Invoices you download from orders now use these details.</span>}
          {err && <span className="small t-debit" role="alert">{err}</span>}
        </div>
      </section>
      <section className="card" style={{ padding: 14 }} aria-label="Invoice preview">
        <b className="small">Preview (sample order)</b>
        <style>{INVOICE_CSS}</style>
        <div className="mt8" style={{ background: "#fff", padding: 14, border: "1px solid var(--line)", borderRadius: 8, overflow: "auto" }} dangerouslySetInnerHTML={{ __html: preview }} />
      </section>
    </div>
  );
}
