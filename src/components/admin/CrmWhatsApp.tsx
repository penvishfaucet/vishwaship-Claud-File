"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { WA_TEMPLATES, fillTemplate, telLink, waLink } from "@/lib/crm";

const log = (body: Record<string, string>) => {
  try { void fetch("/api/admin/crm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), keepalive: true }); } catch { /* logging only */ }
};

/** Quick buttons on a lead card: WhatsApp (first message ready) and Call. The chat opens in the staff member's own WhatsApp. */
export function CrmQuickActions({ id, mobile, name, template = "intro" }: { id: string; mobile: string; name: string; template?: string }) {
  const t = WA_TEMPLATES.find((x) => x.key === template) ?? WA_TEMPLATES[0];
  return (
    <span className="row" style={{ gap: 6 }}>
      <a className="btn btn-sm crm-wa" href={waLink(mobile, fillTemplate(t.text, name))} target="_blank" rel="noopener noreferrer"
        onClick={() => log({ op: "wa_open", id, template: t.key })} aria-label={`WhatsApp ${name}`}>WhatsApp</a>
      <a className="btn btn-sm btn-outline" href={telLink(mobile)} aria-label={`Call ${name}`}>Call</a>
    </span>
  );
}

/** Lead page: pick a ready message (editable), then open the chat in WhatsApp — phone app or WhatsApp Web / Desktop. */
export function CrmWhatsAppComposer({ id, mobile, name, b2b }: { id: string; mobile: string; name: string; b2b?: boolean }) {
  const first = b2b ? "b2b" : "intro";
  const [key, setKey] = useState(first);
  const [text, setText] = useState(fillTemplate(WA_TEMPLATES.find((x) => x.key === first)!.text, name));
  const router = useRouter();
  return (
    <div className="col" style={{ gap: 8 }}>
      <div className="row wrap" style={{ gap: 6 }} role="group" aria-label="Ready messages">
        {WA_TEMPLATES.map((t) => (
          <button key={t.key} type="button" className={`pill${key === t.key ? " on" : ""}`} aria-pressed={key === t.key}
            onClick={() => { setKey(t.key); setText(fillTemplate(t.text, name)); }}>{t.label}</button>
        ))}
      </div>
      <label className="sr-only" htmlFor={`wa-${id}`}>WhatsApp message</label>
      <textarea id={`wa-${id}`} className="input" rows={5} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="row wrap" style={{ gap: 8 }}>
        <a className="btn crm-wa" href={waLink(mobile, text)} target="_blank" rel="noopener noreferrer"
          onClick={() => { log({ op: "wa_open", id, template: key }); setTimeout(() => router.refresh(), 800); }}>Open WhatsApp chat</a>
        <a className="btn btn-outline" href={telLink(mobile)}>Call {mobile}</a>
      </div>
      <p className="tiny muted" style={{ margin: 0 }}>The chat opens in the WhatsApp of this phone / laptop (your business number 9997404427 when that WhatsApp is logged in here — on a laptop use WhatsApp Web or WhatsApp Desktop). Press Send in WhatsApp.</p>
    </div>
  );
}
