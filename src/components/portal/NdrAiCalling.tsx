"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Bot, CheckCircle2, PhoneCall, RotateCcw, Undo2 } from "lucide-react";

/** Client NDR page: switch AI NDR calling on/off, with the price and what happens on each answer. */
export function NdrAiCalling({ enabled, priceRupees, credits, balance, live }: { enabled: boolean; priceRupees: number; credits: number; balance: number; live: boolean }) {
  const [on, setOn] = useState(enabled);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  async function toggle() {
    const next = !on;
    if (next && !confirm(`Turn on AI NDR calling? For every failed delivery our AI calls the buyer and asks if they still want the parcel. ₹${priceRupees} (${credits} credits) per connected call — no charge if the buyer does not pick up.`)) return;
    setBusy(true);
    const r = await fetch("/api/portal/ndr/ai-calling", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: next }) });
    setBusy(false);
    if (r.ok) { setOn(next); router.refresh(); }
  }
  return (
    <section className="card ndr-ai mb16">
      <div className="ndr-ai-head">
        <span className="ndr-ai-ic"><Bot size={26} aria-hidden /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <b style={{ fontSize: 17 }}>AI NDR calling</b>
          <p className="small muted" style={{ margin: "2px 0 0" }}>When a delivery fails, our AI calls your buyer in Hindi or English and asks if they still want the parcel — no manual NDR checking.</p>
        </div>
        <button type="button" className={`cod-switch${on ? " on" : ""}`} role="switch" aria-checked={on} onClick={toggle} disabled={busy} style={{ marginTop: 0, padding: "12px 16px", fontSize: 15 }}>
          <span>{on ? "On" : "Off"}</span><i aria-hidden><b /></i>
        </button>
      </div>
      <div className="ndr-ai-flow">
        <div><PhoneCall size={18} aria-hidden /> NDR → AI calls the buyer</div>
        <div className="ok"><CheckCircle2 size={18} aria-hidden /> “Yes, deliver” → re-attempt sent to the courier</div>
        <div className="bad"><Undo2 size={18} aria-hidden /> “No” → marked for return, you are told</div>
        <div><RotateCcw size={18} aria-hidden /> No answer → tried again once, then you decide</div>
      </div>
      <p className="tiny muted" style={{ margin: "8px 0 0" }}>
        ₹{priceRupees} per connected call ({credits} credits) · no charge if the buyer doesn’t pick up · your balance: <b>{balance.toLocaleString("en-IN")}</b> credits · <Link className="link" href="/portal/billing/notification-credits/">Buy credits</Link>
        {!live && " · Vishwaship is switching AI calling on; your setting is saved."}
      </p>
    </section>
  );
}
