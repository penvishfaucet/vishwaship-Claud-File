"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { StoreSettings } from "@/lib/store-themes";
import { Msg, api } from "./ui";

const PROVIDERS: Array<[StoreSettings["oneClick"]["provider"], string]> = [
  ["none", "No one-click checkout"], ["razorpay_magic", "Razorpay Magic Checkout"], ["gokwik", "GoKwik"], ["shopflo", "Shopflo"], ["cashfree_1cc", "Cashfree One Click Checkout"],
];

/** Connect apps forms: buyer-login OTP source and the one-click checkout request. */
export function ConnectForms({ initial }: { initial: Pick<StoreSettings, "buyerLogin" | "oneClick"> }) {
  const router = useRouter();
  const [bl, setBl] = useState(initial.buyerLogin);
  const [oc, setOc] = useState(initial.oneClick);
  const [busy, setBusy] = useState<"" | "otp" | "oc">("");
  const [msg, setMsg] = useState<{ which: "otp" | "oc"; m: { ok?: string; err?: string } } | null>(null);
  async function save(which: "otp" | "oc") {
    setBusy(which); setMsg(null);
    const r = await api("PUT", "/api/portal/store/settings", { patch: which === "otp" ? { buyerLogin: bl } : { oneClick: oc } });
    setBusy("");
    setMsg({ which, m: r.ok ? { ok: which === "otp" ? "Saved. Buyers see the new login option at once." : oc.provider === "none" ? "Saved." : "Request sent. Vishwaship will contact you to finish activation." } : { err: r.error } });
    if (r.ok) router.refresh();
  }
  const fb = (k: keyof typeof bl.firebase, label: string, ph: string) => (
    <div className="field"><label htmlFor={`fb-${k}`}>{label}</label><input id={`fb-${k}`} className="input mono" placeholder={ph} value={bl.firebase[k]} onChange={(e) => setBl({ ...bl, firebase: { ...bl.firebase, [k]: e.target.value.trim() } })} /></div>
  );
  return (
    <div className="grid2 mb12" style={{ alignItems: "start" }}>
      <form className="card" style={{ padding: 18 }} onSubmit={(e) => { e.preventDefault(); void save("otp"); }}>
        <h3 style={{ margin: "0 0 8px" }}>Buyer login OTP</h3>
        {([["vishwaship", "Vishwaship OTP (credits per login)"], ["own_firebase", "My own Firebase project"], ["email_only", "Email codes only (free)"]] as const).map(([v, l]) => (
          <label key={v} className="row" style={{ gap: 8, alignItems: "center", minHeight: 36 }}><input type="radio" name="otp" checked={bl.otp === v} onChange={() => setBl({ ...bl, otp: v })} /> {l}</label>
        ))}
        {bl.otp === "own_firebase" && (
          <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
            {fb("apiKey", "apiKey", "AIza…")}{fb("authDomain", "authDomain", "yourbrand-123.firebaseapp.com")}{fb("projectId", "projectId", "yourbrand-123")}{fb("appId", "appId (optional)", "1:123:web:abc")}
            <p className="tiny muted" style={{ margin: 0 }}>These Firebase web values are public by design (they are in every web page that uses Firebase). Do not paste any service-account key here.</p>
          </div>
        )}
        {msg?.which === "otp" && <Msg m={msg.m} />}
        <button className="btn btn-orange" style={{ marginTop: 12 }} disabled={busy === "otp"}>{busy === "otp" ? "Saving…" : "Save login option"}</button>
      </form>
      <form className="card" style={{ padding: 18 }} onSubmit={(e) => { e.preventDefault(); void save("oc"); }}>
        <h3 style={{ margin: "0 0 8px" }}>One-click checkout</h3>
        <div className="field"><label htmlFor="oc-p">Provider</label>
          <select id="oc-p" className="input select" value={oc.provider} onChange={(e) => setOc({ ...oc, provider: e.target.value as typeof oc.provider })}>{PROVIDERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        {oc.provider !== "none" && (
          <>
            <div className="field" style={{ marginTop: 8 }}><label htmlFor="oc-m">Your merchant ID with them</label><input id="oc-m" className="input" maxLength={80} value={oc.merchantId} onChange={(e) => setOc({ ...oc, merchantId: e.target.value })} placeholder="From the provider's dashboard or welcome email" /></div>
            <div className="field" style={{ marginTop: 8 }}><label htmlFor="oc-c">Contact for activation (name, phone / email)</label><input id="oc-c" className="input" maxLength={160} value={oc.contact} onChange={(e) => setOc({ ...oc, contact: e.target.value })} required /></div>
            <div className="field" style={{ marginTop: 8 }}><label htmlFor="oc-n">Note (optional)</label><textarea id="oc-n" className="input" rows={2} maxLength={500} value={oc.note} onChange={(e) => setOc({ ...oc, note: e.target.value })} /></div>
            <p className="tiny muted" style={{ margin: "6px 0 0" }}>Never paste API secrets here. The provider shares secret keys with Vishwaship&apos;s team directly during activation.</p>
          </>
        )}
        {oc.status !== "off" && <p className="small" style={{ margin: "8px 0 0" }}>Status: <b>{oc.status === "active" ? "Active" : "Requested — being activated"}</b>{oc.requestedAt ? ` · asked ${new Date(oc.requestedAt).toLocaleDateString("en-IN")}` : ""}</p>}
        {msg?.which === "oc" && <Msg m={msg.m} />}
        <button className="btn btn-orange" style={{ marginTop: 12 }} disabled={busy === "oc"}>{busy === "oc" ? "Saving…" : oc.provider === "none" ? "Save" : "Request activation"}</button>
      </form>
    </div>
  );
}
