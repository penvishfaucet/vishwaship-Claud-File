"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCheck, MessageCircle, RotateCcw, ShieldCheck, Truck, Wallet } from "lucide-react";
import { COD_BUTTONS, COD_SAMPLE, COD_TEMPLATE, fillTemplate } from "@/lib/cod-template";

type Msg = { storeName: string; supportPhone: string; note: string; language: "en" | "hi" };

/** Client COD Confirmation setup: on/off switch, the editable parts of the message and a live WhatsApp preview. */
export function CodSetup(p: {
  enabled: boolean; included: boolean; msg: Msg; businessName: string; defaultPhone: string;
  credits: number; perMessage: number; paisePerCredit: number; expiryHours: number; noReplyText: string; demo: boolean; live: boolean;
}) {
  const router = useRouter();
  const [on, setOn] = useState(p.enabled);
  const [busy, setBusy] = useState(false);
  const [m, setM] = useState<Msg>(p.msg);
  const [saved, setSaved] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const perRupee = Math.round(100 / p.paisePerCredit);
  const msgPaise = p.perMessage * p.paisePerCredit;

  async function toggle() {
    const next = !on;
    if (next && !confirm(`Turn on WhatsApp COD confirmation? Every new COD order waits for the buyer's reply before pickup. ${p.perMessage} credit${p.perMessage === 1 ? "" : "s"} (₹${(msgPaise / 100).toFixed(2)}) per message.`)) return;
    setBusy(true); setErr(null);
    const r = await fetch("/api/portal/notifications", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ channel: "whatsapp", event: "cod_confirmation", enabled: next }) });
    setBusy(false);
    if (!r.ok) { setErr("Could not change the setting — try again"); return; }
    setOn(next); router.refresh();
  }
  async function save() {
    setBusy(true); setErr(null); setSaved(null);
    const r = await fetch("/api/portal/settings/cod_message", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(m) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(j.error?.message ?? "Could not save"); return; }
    setSaved("Saved — new messages use these details.");
  }

  const values = {
    ...COD_SAMPLE,
    store_name: m.storeName || p.businessName,
    store_note: m.note || (m.language === "hi" ? "हम आपके ऑर्डर का ध्यान रखेंगे।" : "We will keep you updated on your order."),
    support_phone: m.supportPhone || p.defaultPhone || COD_SAMPLE.support_phone,
  };
  const text = fillTemplate(COD_TEMPLATE[m.language], values).replace(/\n{3,}/g, "\n\n");

  return (
    <div className="cod-setup">
      <div className="cod-top card">
        <h1>COD Confirmation</h1>
        <div className="cod-credit">
          <div>
            <div className="b">Credit balance: {p.credits.toLocaleString("en-IN")}</div>
            <div className="tiny muted">₹1 = {perRupee} credits · 1 message = {p.perMessage} credit{p.perMessage === 1 ? "" : "s"} (₹{(msgPaise / 100).toFixed(2)})</div>
          </div>
          <Link className="btn btn-orange" href="/portal/billing/notification-credits/"><Wallet size={16} aria-hidden /> Buy Credit</Link>
        </div>
      </div>

      <div className="cod-grid">
        <section className="card cod-main">
          <h2 className="cod-title">WhatsApp COD confirmation</h2>
          <p className="muted">Stop fake and accidental COD orders before they ship — no RTO cost for orders the buyer never wanted.</p>
          <p className="small">1 message = ₹{(msgPaise / 100).toFixed(2)} ({p.perMessage} credit{p.perMessage === 1 ? "" : "s"})</p>

          {p.included ? (
            <button type="button" className={`cod-switch${on ? " on" : ""}`} role="switch" aria-checked={on} onClick={toggle} disabled={busy}>
              <span>Send Confirmation Message</span><i aria-hidden><b /></i>
            </button>
          ) : <p className="note small">COD confirmation is switched off for your account. Contact Vishwaship support to turn it on.</p>}
          {on && p.credits < p.perMessage && <p className="note small t-debit">You have no credits, so messages are not sent and COD orders stay on hold. <Link className="link" href="/portal/billing/notification-credits/">Buy credits</Link> — waiting messages go out automatically.</p>}
          {!p.live && <p className="tiny muted mt8">{p.demo ? "Demo mode: no WhatsApp provider is connected, so messages are recorded but not delivered and no credits are used." : "Vishwaship is connecting WhatsApp. Your setting is saved and messages start as soon as it is live."}</p>}
          {err && <p className="err small" role="alert">{err}</p>}

          <h3>Your message</h3>
          <p className="tiny muted" style={{ marginTop: 0 }}>WhatsApp approves the wording once; you choose the details that go into it.</p>
          <div className="cod-form">
            <div className="field"><label htmlFor="cm-store">Store name shown to the buyer</label><input id="cm-store" className="input" maxLength={40} placeholder={p.businessName} value={m.storeName} onChange={(e) => setM({ ...m, storeName: e.target.value })} /></div>
            <div className="field"><label htmlFor="cm-phone">Help number for buyers</label><input id="cm-phone" className="input" maxLength={20} inputMode="tel" placeholder={p.defaultPhone || "+91 …"} value={m.supportPhone} onChange={(e) => setM({ ...m, supportPhone: e.target.value })} /></div>
            <div className="field full"><label htmlFor="cm-note">Your note (optional)</label><input id="cm-note" className="input" maxLength={120} placeholder="e.g. Free returns within 7 days." value={m.note} onChange={(e) => setM({ ...m, note: e.target.value })} /><span className="tiny muted">{m.note.length}/120</span></div>
            <div className="field"><label htmlFor="cm-lang">Language</label><select id="cm-lang" className="select" value={m.language} onChange={(e) => setM({ ...m, language: e.target.value as Msg["language"] })}><option value="en">English</option><option value="hi">हिंदी (Hindi)</option></select>{m.language === "hi" && <span className="tiny muted">Hindi goes out once Vishwaship has an approved Hindi template; until then English is used.</span>}</div>
            <div className="field" style={{ alignSelf: "end" }}><button type="button" className="btn btn-navy" onClick={save} disabled={busy}>Save message</button></div>
          </div>
          {saved && <p className="small t-credit" role="status">{saved}</p>}

          <h3>Why use COD confirmation?</h3>
          <ul className="cod-why">
            <li><ShieldCheck size={16} aria-hidden /> Catch fake or accidental COD orders before pickup.</li>
            <li><RotateCcw size={16} aria-hidden /> Fewer RTOs — you don't pay forward and return freight for unwanted orders.</li>
            <li><CheckCheck size={16} aria-hidden /> The buyer confirms the address and the COD amount in one tap.</li>
            <li><Truck size={16} aria-hidden /> The buyer knows the expected delivery date, so more orders are accepted at the door.</li>
          </ul>

          <h3>How it works</h3>
          <ol className="cod-flow">
            <li>A COD order is created (manual, bulk, store or API). It is held, and the buyer gets this WhatsApp message.</li>
            <li><b>Confirm Order</b> → the order is released and ships as usual. The order shows <b>“Buyer confirmed — ship it”</b>.</li>
            <li><b>Cancel Order</b> → the order is cancelled automatically (if already booked, the courier booking is cancelled and the shipping charge refunded). It shows <b>“Buyer wants to cancel”</b>.</li>
            <li>No reply in {p.expiryHours} h → <b>“No reply from buyer”</b> and {p.noReplyText}.</li>
            <li>The buyer's answer shows on every order card and in the table (New, Pickups &amp; Manifests, All).</li>
          </ol>
        </section>

        <aside className="cod-phone-wrap" aria-label="WhatsApp message preview">
          <span className="cod-badge"><MessageCircle size={14} aria-hidden /> Order confirmation</span>
          <div className="cod-phone">
            <div className="cod-phone-top"><b>{values.store_name}</b><span>Business account</span></div>
            <div className="cod-chat">
              <div className="cod-bubble in">
                <div className="cod-text">{text}</div>
                <div className="cod-time">9:30 AM</div>
                <div className="cod-btns"><span>↩ {COD_BUTTONS.confirm}</span><span>↩ {COD_BUTTONS.cancel}</span></div>
              </div>
              <div className="cod-bubble out"><div className="cod-text">{COD_BUTTONS.confirm}</div><div className="cod-time">9:40 AM ✓✓</div></div>
            </div>
          </div>
          <p className="tiny muted center">Sample buyer and order. Your buyer sees their own name, order, COD amount and address.</p>
        </aside>
      </div>
    </div>
  );
}
