"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { POLICY_KINDS, type PolicyKind, type StoreSettings } from "@/lib/store-themes";
import { Msg, api, toPaise, toRupees } from "./ui";

/** Step 4: COD, shipping fee, pickup warehouse. Online payments (merchant Razorpay) arrive in the next phase. */
export function CheckoutStep({ initial, warehouses }: { initial: StoreSettings["checkout"]; warehouses: Array<{ id: string; label: string }> }) {
  const router = useRouter();
  const [f, setF] = useState({
    codEnabled: initial.codEnabled, codFee: toRupees(initial.codFeePaise), codMin: toRupees(initial.codMinPaise), codMax: toRupees(initial.codMaxPaise),
    ship: toRupees(initial.shippingFeePaise), freeAbove: toRupees(initial.freeShippingAbovePaise), warehouseId: initial.warehouseId ?? warehouses[0]?.id ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; err?: string } | null>(null);
  const set = (k: keyof typeof f, v: string | boolean) => setF({ ...f, [k]: v });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!f.warehouseId) { setMsg({ err: "Add a pickup warehouse first (Warehouse in the menu)" }); return; }
    setBusy(true); setMsg(null);
    const r = await api("PUT", "/api/portal/store/settings", { step: 4, patch: { checkout: {
      codEnabled: f.codEnabled, codFeePaise: toPaise(f.codFee), codMinPaise: toPaise(f.codMin), codMaxPaise: toPaise(f.codMax),
      shippingFeePaise: toPaise(f.ship), freeShippingAbovePaise: toPaise(f.freeAbove), warehouseId: f.warehouseId,
    } } });
    setBusy(false);
    if (!r.ok) { setMsg({ err: r.error }); return; }
    router.push("/portal/store/setup/5/"); router.refresh();
  }

  const money = (k: "codFee" | "codMin" | "codMax" | "ship" | "freeAbove", label: string, hint?: string) => (
    <div className="field"><label htmlFor={k}>{label}</label>
      <input id={k} className="input" inputMode="decimal" value={f[k]} onChange={(e) => set(k, e.target.value.replace(/[^0-9.]/g, ""))} />
      {hint && <span className="small muted">{hint}</span>}</div>
  );

  return (
    <form className="card" style={{ padding: 20, maxWidth: 760 }} onSubmit={submit}>
      <h3 style={{ marginBottom: 8 }}>Pickup</h3>
      <div className="field"><label htmlFor="wh">Ship orders from <span className="req">*</span></label>
        {warehouses.length ? (
          <select id="wh" className="input select" value={f.warehouseId} onChange={(e) => set("warehouseId", e.target.value)}>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}</select>
        ) : <p className="small">No warehouse yet. <a className="orange" href="/portal/addresses/">Add a pickup warehouse</a>, then come back.</p>}
      </div>
      <h3 style={{ margin: "20px 0 8px" }}>Shipping charge to buyers</h3>
      <div className="grid2">{money("ship", "Shipping fee (₹)", "0 = free shipping")}{money("freeAbove", "Free shipping above (₹)", "0 = off")}</div>
      <h3 style={{ margin: "20px 0 8px" }}>Cash on Delivery</h3>
      <label className="row" style={{ gap: 8, alignItems: "center", fontWeight: 500 }}>
        <input type="checkbox" checked={f.codEnabled} onChange={(e) => set("codEnabled", e.target.checked)} /> Accept Cash on Delivery
      </label>
      {f.codEnabled && <div className="grid3" style={{ marginTop: 10 }}>{money("codFee", "COD fee (₹)")}{money("codMin", "Min order for COD (₹)")}{money("codMax", "Max order for COD (₹)")}</div>}
      <p className="small muted" style={{ marginTop: 8 }}>COD orders use your existing COD confirmation settings (WhatsApp confirm / cancel) before pickup.</p>
      <h3 style={{ margin: "20px 0 8px" }}>Online payments</h3>
      <p className="small muted">Connect your own Razorpay account in <a className="orange" href="/portal/store/payments/">Online Payments</a>. Store payments go to your Razorpay account, not your Vishwaship wallet. Without it, buyers see Cash on Delivery only.</p>
      <Msg m={msg} />
      <button className="btn btn-orange" style={{ marginTop: 16 }} disabled={busy}>{busy ? "Saving…" : "Save & continue"}</button>
    </form>
  );
}

const SAMPLE: Record<PolicyKind, (n: string) => string> = {
  shipping: (n) => `${n} ships orders within 1-2 working days. Delivery usually takes 3-7 working days depending on your location. You will receive a tracking link by SMS/WhatsApp once your order is shipped.`,
  refund: (n) => `If you receive a damaged or wrong item, contact ${n} within 7 days of delivery with photos. Eligible returns are refunded to the original payment method (or bank account for Cash on Delivery orders) within 7 working days of receiving the return.`,
  privacy: (n) => `${n} collects your name, phone number, email and address only to process and deliver your order and to contact you about it. We do not sell your personal information.`,
  terms: (n) => `By placing an order with ${n} you agree to provide correct delivery details. Prices include applicable taxes unless stated. Orders may be cancelled if an item is out of stock, in which case any payment is refunded in full.`,
};

/** About, contact, policies and SEO. */
export function PagesForm({ initial, storeName }: { initial: StoreSettings; storeName: string }) {
  const router = useRouter();
  const [s, setS] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; err?: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const r = await api("PUT", "/api/portal/store/settings", { patch: { tagline: s.tagline, about: s.about, contact: s.contact, policies: s.policies, seo: s.seo, social: s.social } });
    setBusy(false);
    setMsg(r.ok ? { ok: "Saved. Changes show on your store right away." } : { err: r.error });
    if (r.ok) router.refresh();
  }

  return (
    <form onSubmit={submit} style={{ maxWidth: 860 }}>
      <div className="card mb12" style={{ padding: 20 }}>
        <h3 style={{ marginBottom: 10 }}>About your store</h3>
        <div className="field"><label htmlFor="tag">Tagline</label><input id="tag" className="input" maxLength={140} value={s.tagline} onChange={(e) => setS({ ...s, tagline: e.target.value })} placeholder="One line about what you sell" /></div>
        <div className="field" style={{ marginTop: 12 }}><label htmlFor="about">About us page</label><textarea id="about" className="input" rows={5} maxLength={5000} value={s.about} onChange={(e) => setS({ ...s, about: e.target.value })} /></div>
      </div>
      <div className="card mb12" style={{ padding: 20 }}>
        <h3 style={{ marginBottom: 10 }}>Contact details (shown to buyers)</h3>
        <div className="grid2">
          <div className="field"><label htmlFor="ce">Email</label><input id="ce" type="email" className="input" maxLength={120} value={s.contact.email} onChange={(e) => setS({ ...s, contact: { ...s.contact, email: e.target.value } })} /></div>
          <div className="field"><label htmlFor="cp">Phone</label><input id="cp" className="input" inputMode="tel" maxLength={20} value={s.contact.phone} onChange={(e) => setS({ ...s, contact: { ...s.contact, phone: e.target.value } })} /></div>
          <div className="field"><label htmlFor="cw">WhatsApp number</label><input id="cw" className="input" inputMode="tel" maxLength={20} value={s.contact.whatsapp} onChange={(e) => setS({ ...s, contact: { ...s.contact, whatsapp: e.target.value } })} /></div>
          <div className="field"><label htmlFor="ca">Address</label><textarea id="ca" className="input" rows={2} maxLength={400} value={s.contact.address} onChange={(e) => setS({ ...s, contact: { ...s.contact, address: e.target.value } })} /></div>
        </div>
      </div>
      <div className="card mb12" style={{ padding: 20 }}>
        <h3 style={{ marginBottom: 4 }}>Social links</h3>
        <p className="small muted" style={{ marginBottom: 10 }}>Shown as icons in your store footer. Paste the full link starting with https://</p>
        <div className="grid2">
          {(["instagram", "facebook", "youtube"] as const).map((k) => (
            <div className="field" key={k}><label htmlFor={`so-${k}`}>{k === "youtube" ? "YouTube" : k[0].toUpperCase() + k.slice(1)}</label>
              <input id={`so-${k}`} className="input" inputMode="url" maxLength={200} placeholder={`https://${k}.com/yourpage`} value={s.social[k]} onChange={(e) => setS({ ...s, social: { ...s.social, [k]: e.target.value.trim() } })} /></div>
          ))}
        </div>
      </div>
      <div className="card mb12" style={{ padding: 20 }}>
        <h3 style={{ marginBottom: 4 }}>Policy pages</h3>
        <p className="small muted" style={{ marginBottom: 10 }}>Required before you publish. Start from a sample and edit it to match how you work.</p>
        {(Object.keys(POLICY_KINDS) as PolicyKind[]).map((k) => (
          <div className="field" key={k} style={{ marginTop: 12 }}>
            <div className="row between"><label htmlFor={`pol-${k}`}>{POLICY_KINDS[k]}</label>
              {!s.policies[k] && <button type="button" className="link small" onClick={() => setS({ ...s, policies: { ...s.policies, [k]: SAMPLE[k](storeName) } })}>Use sample text</button>}</div>
            <textarea id={`pol-${k}`} className="input" rows={4} maxLength={8000} value={s.policies[k]} onChange={(e) => setS({ ...s, policies: { ...s.policies, [k]: e.target.value } })} />
          </div>
        ))}
      </div>
      <div className="card mb12" style={{ padding: 20 }}>
        <h3 style={{ marginBottom: 10 }}>Search engines (SEO)</h3>
        <div className="field"><label htmlFor="st">Title <span className="small muted">({s.seo.title.length}/70)</span></label><input id="st" className="input" maxLength={70} value={s.seo.title} onChange={(e) => setS({ ...s, seo: { ...s.seo, title: e.target.value } })} /></div>
        <div className="field" style={{ marginTop: 12 }}><label htmlFor="sd">Description <span className="small muted">({s.seo.description.length}/160)</span></label><textarea id="sd" className="input" rows={2} maxLength={160} value={s.seo.description} onChange={(e) => setS({ ...s, seo: { ...s.seo, description: e.target.value } })} /></div>
        <p className="small muted" style={{ marginTop: 8 }}>Search engines can index your store only after you publish. Drafts and previews are always hidden.</p>
      </div>
      <Msg m={msg} />
      <button className="btn btn-orange" style={{ marginTop: 12 }} disabled={busy}>{busy ? "Saving…" : "Save pages"}</button>
    </form>
  );
}

/** Continue / skip buttons for steps that are optional or managed on another page. */
export function StepNext({ step, label = "Continue", skip }: { step: number; label?: string; skip?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function go() {
    setBusy(true); setErr("");
    const r = await api("PATCH", "/api/portal/store", { step });
    setBusy(false);
    if (!r.ok) { setErr(r.error); return; }
    router.push(`/portal/store/setup/${Math.min(7, step + 1)}/`); router.refresh();
  }
  return (
    <>
      <button className={`btn ${skip ? "btn-outline" : "btn-orange"}`} onClick={go} disabled={busy}>{busy ? "Saving…" : label}</button>
      {err && <span className="field-err" role="alert">{err}</span>}
    </>
  );
}

/** Step 7 publish button. */
export function PublishButton({ disabled, live }: { disabled: boolean; live: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; err?: string } | null>(null);
  async function go() {
    setBusy(true); setMsg(null);
    const r = await api<{ version: number }>("POST", "/api/portal/store/theme", { action: "publish", note: "Launch" });
    setBusy(false);
    setMsg(r.ok ? { ok: `Your store is live (version ${r.data.version}).` } : { err: r.error });
    router.refresh();
  }
  return (
    <div>
      <button className="btn btn-orange btn-lg" onClick={go} disabled={busy || disabled}>{busy ? "Publishing…" : live ? "Publish latest changes" : "Publish my store"}</button>
      <Msg m={msg} />
    </div>
  );
}
