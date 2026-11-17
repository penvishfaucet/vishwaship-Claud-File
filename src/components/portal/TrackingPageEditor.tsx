"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BuyerTracking } from "@/components/public/BuyerTracking";
import type { TrackingPageSettings } from "@/lib/tracking-page";

const SAMPLE = {
  orderNumber: "SAMPLE-1001", awb: "DEMO1234567890", carrierCode: "delhivery", carrierName: "Delhivery", status: "out_for_delivery",
  etaDate: new Date(Date.now() + 86400_000).toISOString(),
  events: [
    { status: "Booked", location: "Origin hub", at: new Date(Date.now() - 3 * 86400_000).toISOString() },
    { status: "In transit", location: "Sorting centre", at: new Date(Date.now() - 86400_000).toISOString() },
    { status: "Out for delivery", location: "Destination hub", at: new Date().toISOString() },
  ],
};

export function TrackingPageEditor({ initial, status, publicUrl }: { initial: TrackingPageSettings; status: { isPublished: boolean; publishedAt: string | null; disabledByAdmin: boolean; hasUnpublished: boolean }; publicUrl: string }) {
  const router = useRouter();
  const [f, setF] = useState<TrackingPageSettings>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok?: string; err?: string } | null>(null);
  const [dirty, setDirty] = useState(false);
  const set = <K extends keyof TrackingPageSettings>(k: K, v: TrackingPageSettings[K]) => { setF({ ...f, [k]: v }); setDirty(true); };

  async function save() {
    setBusy("save"); setMsg(null);
    const r = await fetch("/api/portal/tracking-page", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(f) });
    const j = await r.json(); setBusy(null);
    if (!r.ok) { setMsg({ err: j.error?.issues?.[0] ? `${j.error.issues[0].path}: ${j.error.issues[0].message}` : j.error?.message ?? "Could not save" }); return false; }
    setDirty(false); setMsg({ ok: "Draft saved. Your live page is unchanged until you publish." }); router.refresh(); return true;
  }
  async function act(action: "publish" | "unpublish") {
    if (action === "publish" && dirty && !(await save())) return;
    setBusy(action); setMsg(null);
    const r = await fetch("/api/portal/tracking-page", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) });
    const j = await r.json(); setBusy(null);
    setMsg(r.ok ? { ok: action === "publish" ? "Published — buyers now see this page." : "Unpublished — buyers see the standard Vishwaship tracking page." } : { err: j.error?.message ?? "Failed" });
    router.refresh();
  }
  function onLogo(file: File | undefined) {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) { setMsg({ err: "Logo must be PNG, JPG or WebP" }); return; }
    if (file.size > 150_000) { setMsg({ err: "Logo must be under 150 KB" }); return; }
    const rd = new FileReader(); rd.onload = () => set("logo", String(rd.result)); rd.readAsDataURL(file);
  }

  return (
    <>
      <div className="card mb12" style={{ padding: 14 }}>
        <div className="row between wrap" style={{ gap: 8 }}>
          <div>
            <span className={`chip ${status.disabledByAdmin ? "c-cancelled" : status.isPublished ? "c-active" : "c-draft"}`}>{status.disabledByAdmin ? "Paused by Vishwaship" : status.isPublished ? "Published" : "Not published"}</span>
            {status.publishedAt && <span className="tiny muted" style={{ marginLeft: 8 }}>Last published {new Date(status.publishedAt).toLocaleString("en-IN")}</span>}
            {(dirty || (status.isPublished && status.hasUnpublished)) && <span className="tiny" style={{ marginLeft: 8, color: "var(--orange)" }}>You have unpublished changes</span>}
          </div>
          <div className="row" style={{ gap: 6 }}>
            <button className="btn btn-outline" onClick={save} disabled={!!busy}>{busy === "save" ? "Saving…" : "Save draft"}</button>
            {status.isPublished && <button className="btn btn-outline" onClick={() => act("unpublish")} disabled={!!busy}>Unpublish</button>}
            <button className="btn btn-orange" onClick={() => act("publish")} disabled={!!busy || status.disabledByAdmin}>{busy === "publish" ? "Publishing…" : "Publish"}</button>
          </div>
        </div>
        <p className="small mt8" style={{ margin: "8px 0 0" }}>Public link for your buyers: <a className="link" href={publicUrl} target="_blank" rel="noopener">{publicUrl}</a> {status.isPublished ? "" : <span className="muted">(works after you publish)</span>}</p>
        {msg?.ok && <p className="small t-credit" role="status" style={{ margin: "8px 0 0" }}>{msg.ok}</p>}
        {msg?.err && <p className="small err" role="alert" style={{ margin: "8px 0 0" }}>{msg.err}</p>}
      </div>
      <div className="split" style={{ gap: 16, alignItems: "start" }}>
        <section className="card" style={{ padding: 16 }} aria-label="Tracking page settings">
          <div className="grid2" style={{ gap: 10 }}>
            <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="tp-n">Business name</label><input id="tp-n" className="input" value={f.businessName} onChange={(e) => set("businessName", e.target.value)} /></div>
            <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="tp-l">Logo (PNG/JPG/WebP, max 150 KB)</label><input id="tp-l" type="file" accept="image/png,image/jpeg,image/webp" className="input" onChange={(e) => onLogo(e.target.files?.[0])} />{f.logo && <button type="button" className="link small mt8" onClick={() => set("logo", "")}>Remove logo</button>}</div>
            <div className="field"><label htmlFor="tp-p">Brand colour</label><input id="tp-p" type="color" className="input" value={f.primaryColor} onChange={(e) => set("primaryColor", e.target.value)} /></div>
            <div className="field"><label htmlFor="tp-a">Accent colour</label><input id="tp-a" type="color" className="input" value={f.accentColor} onChange={(e) => set("accentColor", e.target.value)} /></div>
            <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="tp-h">Headline</label><input id="tp-h" className="input" maxLength={80} value={f.headline} onChange={(e) => set("headline", e.target.value)} /></div>
            <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="tp-m">Message to buyers</label><textarea id="tp-m" className="textarea" rows={3} maxLength={400} value={f.message} onChange={(e) => set("message", e.target.value)} placeholder="Thank you for shopping with us!" /></div>
            <div className="field"><label htmlFor="tp-sp">Support phone</label><input id="tp-sp" className="input" value={f.supportPhone} onChange={(e) => set("supportPhone", e.target.value)} /></div>
            <div className="field"><label htmlFor="tp-se">Support email</label><input id="tp-se" type="email" className="input" value={f.supportEmail} onChange={(e) => set("supportEmail", e.target.value)} /></div>
            <div className="field"><label htmlFor="tp-sh">Support hours</label><input id="tp-sh" className="input" value={f.supportHours} onChange={(e) => set("supportHours", e.target.value)} placeholder="Mon–Sat, 10 AM – 7 PM" /></div>
            <div className="field"><label htmlFor="tp-f">Footer text</label><input id="tp-f" className="input" maxLength={120} value={f.footerText} onChange={(e) => set("footerText", e.target.value)} /></div>
            <label className="check small" style={{ gridColumn: "1 / -1" }}><input type="checkbox" checked={f.showCarrier} onChange={(e) => set("showCarrier", e.target.checked)} /> Show courier name and AWB</label>
          </div>
        </section>
        <section aria-label="Preview" className="card p0" style={{ overflow: "hidden", maxHeight: 640, overflowY: "auto" }}>
          <div className="tiny muted" style={{ padding: "8px 12px", borderBottom: "1px solid var(--line-2)" }}>Live preview (sample shipment)</div>
          <div style={{ zoom: 0.8 }}><BuyerTracking brand={f} shipment={SAMPLE} footer="Shipping powered by Vishwaship" preview /></div>
        </section>
      </div>
    </>
  );
}
