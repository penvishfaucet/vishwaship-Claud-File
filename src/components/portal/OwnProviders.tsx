"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Bot, Check, Copy, MessageCircle } from "lucide-react";

type Field = { key: string; label: string; secret: boolean; placeholder: string };
type Conn = null | { adapter: string; hints: Record<string, string>; values: Record<string, string>; on: boolean; lastTestOk: boolean | null; lastTestMessage: string | null; lastTestAt: string | null; webhookUrl: string };

/** Client page: connect their own WATI / AiSensy (WhatsApp) and Bolna (AI calling) — no Vishwaship charges. */
export function OwnProviders({ fields, whatsapp, calling, codTemplateText }: { fields: Record<"wati" | "aisensy" | "bolna", Field[]>; whatsapp: Conn; calling: Conn; codTemplateText: { named: string; numbered: string; order: string } }) {
  return (
    <div className="op-grid">
      <Card kind="whatsapp" title="Your own WhatsApp" icon={<MessageCircle size={22} aria-hidden />} options={["wati", "aisensy"]} conn={whatsapp} fields={fields}
        intro="COD confirmations (and out-for-delivery updates) go from your own business WhatsApp number. No Vishwaship credits are used."
        steps={[
          "Create the COD confirmation template in your WATI / AiSensy account with two quick-reply buttons: “Confirm Order” and “Cancel Order”, and get it approved.",
          "Copy the API details below → Save → Test connection → Switch on.",
          "Add the webhook URL shown after saving in WATI (Webhooks → message received + status) or AiSensy (Manage → Webhooks), so buyer replies reach Vishwaship.",
        ]}
        extra={<details className="op-tpl"><summary>Ready-made template text</summary>
          <div className="small"><b>WATI</b> (named variables):<pre>{codTemplateText.named}</pre><b>AiSensy</b> (numbered):<pre>{codTemplateText.numbered}</pre><span className="tiny muted">{codTemplateText.order}</span></div></details>} />
      <Card kind="calling" title="Your own AI calling" icon={<Bot size={22} aria-hidden />} options={["bolna"]} conn={calling} fields={fields}
        intro="AI NDR calls run on your own Bolna account and number. No Vishwaship charge per call."
        steps={[
          "In Bolna, create an agent for NDR calls (Hindi + English). It receives buyer_name, store_name, order_id, awb, courier, cod_amount, delivery_address and failure_reason.",
          "In the agent’s Extraction tab add ndr_decision (reattempt or rto), preferred_date and new_address.",
          "Save your API key and Agent ID below → Test connection → Switch on, then put the webhook URL shown after saving in the agent’s settings.",
        ]} />
    </div>
  );
}

function Card({ kind, title, icon, intro, steps, options, conn, fields, extra }: { kind: "whatsapp" | "calling"; title: string; icon: React.ReactNode; intro: string; steps: string[]; options: Array<"wati" | "aisensy" | "bolna">; conn: Conn; fields: Record<string, Field[]>; extra?: React.ReactNode }) {
  const router = useRouter();
  const [adapter, setAdapter] = useState<string>(conn?.adapter ?? options[0]);
  const [vals, setVals] = useState<Record<string, string>>(conn?.values ?? {});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; err?: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const post = async (body: unknown) => {
    setBusy(true); setMsg(null);
    const r = await fetch("/api/portal/own-providers/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (r.ok) { setMsg({ ok: j.message }); router.refresh(); } else setMsg({ err: j.error?.message ?? "Failed" });
  };
  const status = !conn ? "Not connected" : conn.on ? "On — your account is used" : conn.lastTestOk ? "Tested — switch on" : "Saved — test it";
  return (
    <section className="card op-card">
      <div className="op-head"><span className="op-ic">{icon}</span><div style={{ flex: 1 }}><b style={{ fontSize: 17 }}>{title}</b><p className="small muted" style={{ margin: "2px 0 0" }}>{intro}</p></div><span className={`chip ${conn?.on ? "c-active" : "c-draft"}`}>{status}</span></div>
      <ol className="op-steps">{steps.map((s) => <li key={s}>{s}</li>)}</ol>
      {extra}
      {options.length > 1 && (
        <div className="op-tabs" role="tablist" aria-label="Provider">{options.map((o) => <button key={o} type="button" role="tab" aria-selected={adapter === o} className={adapter === o ? "on" : ""} onClick={() => { setAdapter(o); setVals(conn?.adapter === o ? conn.values : {}); }}>{o === "wati" ? "WATI" : "AiSensy"}</button>)}</div>
      )}
      <form className="op-form" onSubmit={(e) => { e.preventDefault(); void post({ op: "save", adapter, values: vals }); }}>
        {fields[adapter].map((f) => (
          <div className="field" key={f.key}><label htmlFor={`${kind}-${f.key}`}>{f.label}</label>
            <input id={`${kind}-${f.key}`} className="input" type={f.secret ? "password" : "text"} autoComplete="off" placeholder={f.secret && conn?.adapter === adapter && conn.hints[f.key] ? `Saved (${conn.hints[f.key]}) — leave blank to keep` : f.placeholder} value={vals[f.key] ?? ""} onChange={(e) => setVals({ ...vals, [f.key]: e.target.value })} />
          </div>
        ))}
        <div className="row wrap" style={{ gap: 8 }}>
          <button className="btn btn-navy" disabled={busy}>Save</button>
          {conn && <button type="button" className="btn btn-outline" disabled={busy} onClick={() => void post({ op: "test", kind })}>Test connection</button>}
          {conn && (conn.on
            ? <button type="button" className="btn btn-outline" disabled={busy} onClick={() => void post({ op: "set", kind, on: false })}>Switch off</button>
            : <button type="button" className="btn btn-orange" disabled={busy || !conn.lastTestOk} onClick={() => void post({ op: "set", kind, on: true })}>Switch on</button>)}
          {conn && <button type="button" className="btn btn-sm btn-ghost" disabled={busy} onClick={() => { if (confirm("Remove your saved keys?")) void post({ op: "set", kind, on: "remove" }); }}>Remove</button>}
        </div>
      </form>
      {conn?.lastTestMessage && <p className={`small ${conn.lastTestOk ? "t-credit" : "err"}`} style={{ margin: "8px 0 0" }}>{conn.lastTestMessage}</p>}
      {msg?.ok && <p className="small t-credit" role="status">{msg.ok}</p>}
      {msg?.err && <p className="small err" role="alert">{msg.err}</p>}
      {conn && (
        <div className="op-hook"><span className="tiny b">Your webhook URL</span>
          <div className="te-code"><pre>{conn.webhookUrl}</pre><button type="button" className="btn btn-sm btn-outline" onClick={async () => { try { await navigator.clipboard.writeText(conn.webhookUrl); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* blocked */ } }}>{copied ? <><Check size={14} aria-hidden /> Copied</> : <><Copy size={14} aria-hidden /> Copy</>}</button></div>
          <span className="tiny muted">Keep it private — anyone with this link can post replies for your account.</span>
        </div>
      )}
    </section>
  );
}
