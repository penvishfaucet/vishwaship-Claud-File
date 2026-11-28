"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { telLink, waLink } from "@/lib/crm";

export type ChatMsg = { id: string; dir: "in" | "out" | "manual"; text: string; at: string; status?: string | null; error?: string | null; mediaType?: string | null; mediaUrl?: string | null; by?: string | null };
export type TemplateOpt = { name: string; language: string; header: string; body: string; vars: string[]; buttons: string[]; mediaUrl: string };

const fill = (t: TemplateOpt, name: string) => {
  const first = (name || "").trim().split(/\s+/)[0] || "ji";
  return t.vars.reduce((s, v) => s.replace(new RegExp(`\\{\\{\\s*${v}\\s*\\}\\}`, "g"), first), t.body);
};
const tick = (s?: string | null) => (s === "read" ? "✓✓ read" : s === "delivered" ? "✓✓" : s === "failed" ? "⚠ failed" : s === "sent" ? "✓" : "");
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "numeric", minute: "2-digit", hour12: true });

/**
 * Lead page with WhatsApp for CRM connected: the chat with this lead (sent from the business number through the
 * Cloud API, replies from the webhook), send an approved template with its photo / video, or free text within 24 hours.
 */
export function CrmWaChat({ id, mobile, name, chat, templates, windowOpen, windowEndsAt, templatesError, firstTemplate }: {
  id: string; mobile: string; name: string; chat: ChatMsg[]; templates: TemplateOpt[]; windowOpen: boolean; windowEndsAt: string | null; templatesError?: string; firstTemplate?: string;
}) {
  const router = useRouter();
  const [tpl, setTpl] = useState(firstTemplate && templates.some((t) => t.name === firstTemplate) ? firstTemplate : templates[0]?.name ?? "");
  const [media, setMedia] = useState("");
  const [text, setText] = useState("");
  const [mType, setMType] = useState<"" | "image" | "video">("");
  const [mUrl, setMUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const t = templates.find((x) => x.name === tpl);
  const needsMedia = !!t && ["IMAGE", "VIDEO", "DOCUMENT"].includes(t.header);
  const shownMedia = media.trim() || t?.mediaUrl || "";
  async function post(body: Record<string, unknown>) {
    setBusy(true); setMsg(null);
    const r = await fetch("/api/admin/crm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, ...body }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setBusy(false);
    setMsg(r?.ok ? { ok: true, text: j.message ?? "Sent" } : { ok: false, text: j.error?.message ?? "Could not send — check your internet" });
    if (r?.ok) { setText(""); setMUrl(""); setMType(""); router.refresh(); }
  }
  return (
    <div className="col" style={{ gap: 10 }}>
      <div className="crm-chat" aria-label={`WhatsApp chat with ${name}`} aria-live="polite">
        {chat.length === 0 ? <p className="tiny muted" style={{ margin: 0 }}>No WhatsApp messages yet. Send the intro below.</p> : chat.map((m) => (
          <div key={m.id} className={`crm-bub ${m.dir}`}>
            {m.mediaUrl && m.mediaType === "image" && <img src={m.mediaUrl} alt="" className="crm-bub-media" loading="lazy" />}
            {m.mediaUrl && m.mediaType === "video" && <video src={m.mediaUrl} className="crm-bub-media" controls preload="none" />}
            <div className="small" style={{ whiteSpace: "pre-wrap" }}>{m.text}</div>
            <div className="tiny crm-bub-f">{m.dir === "manual" ? "logged · " : ""}{when(m.at)}{m.dir !== "in" && m.by ? ` · ${m.by}` : ""} {m.dir === "out" && <b className={m.status === "failed" ? "red" : m.status === "read" ? "t-ok" : ""}>{tick(m.status)}</b>}{m.error ? ` — ${m.error}` : ""}</div>
          </div>
        ))}
      </div>

      {windowOpen && (
        <div className="col" style={{ gap: 6 }}>
          <label className="small b" htmlFor={`wt-${id}`}>Reply — free message (open until {windowEndsAt ? when(windowEndsAt) : "24 h after their last message"})</label>
          <textarea id={`wt-${id}`} className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Type your message…" />
          <div className="row wrap" style={{ gap: 6 }}>
            <label className="sr-only" htmlFor={`wmt-${id}`}>Attach</label>
            <select id={`wmt-${id}`} className="select" value={mType} onChange={(e) => setMType(e.target.value as "" | "image" | "video")} style={{ width: "auto" }}>
              <option value="">No attachment</option><option value="image">Photo link</option><option value="video">Video link</option>
            </select>
            {mType && <input className="input" style={{ flex: 1, minWidth: 200 }} value={mUrl} onChange={(e) => setMUrl(e.target.value)} placeholder="https://… (.jpg / .png / .mp4)" aria-label="Photo or video link" />}
            {mType && templates.some((x) => x.mediaUrl) && (
              <select className="select" style={{ width: "auto" }} aria-label="Use a saved photo / video" value="" onChange={(e) => e.target.value && setMUrl(e.target.value)}>
                <option value="">Saved media…</option>
                {templates.filter((x) => x.mediaUrl).map((x) => <option key={x.name} value={x.mediaUrl}>{x.name}</option>)}
              </select>
            )}
            <button type="button" className="btn crm-wa" disabled={busy || (!text.trim() && !(mType && mUrl))} onClick={() => post({ op: "wa_text", text, mediaType: mType, mediaUrl: mUrl })}>{busy ? "Sending…" : "Send"}</button>
          </div>
        </div>
      )}

      <div className="crm-wa-tpl col" style={{ gap: 6 }}>
        <div className="small b">{windowOpen ? "Or send a template" : "Send a WhatsApp template"} <span className="tiny muted">(approved by Meta — needed for the first message and after 24 h)</span></div>
        {templatesError ? <p className="tiny err" style={{ margin: 0 }}>{templatesError}</p> : templates.length === 0 ? (
          <p className="tiny muted" style={{ margin: 0 }}>No approved template yet. Create the intro template in WhatsApp Manager (header photo / video) — it appears here once Meta approves it.</p>
        ) : (
          <>
            <div className="row wrap" style={{ gap: 6 }} role="group" aria-label="Templates">
              {templates.map((x) => <button key={x.name} type="button" className={`pill${tpl === x.name ? " on" : ""}`} aria-pressed={tpl === x.name} onClick={() => { setTpl(x.name); setMedia(""); }}>{x.name}{x.header === "IMAGE" ? " 🖼️" : x.header === "VIDEO" ? " 🎬" : ""}</button>)}
            </div>
            {t && (
              <div className="crm-bub out preview">
                {needsMedia && shownMedia && (t.header === "VIDEO" ? <video src={shownMedia} className="crm-bub-media" controls preload="none" /> : t.header === "IMAGE" ? <img src={shownMedia} alt="" className="crm-bub-media" /> : <span className="tiny">📄 {shownMedia}</span>)}
                <div className="small" style={{ whiteSpace: "pre-wrap" }}>{fill(t, name)}</div>
                {t.buttons.length > 0 && <div className="tiny muted">Buttons: {t.buttons.join(" · ")}</div>}
              </div>
            )}
            {needsMedia && (
              <input className="input" value={media} onChange={(e) => setMedia(e.target.value)} aria-label="Photo or video link for this message"
                placeholder={t?.mediaUrl ? `The saved ${t.header === "VIDEO" ? "video" : "photo"} is used — paste another link to change it for this lead` : `Paste the ${t?.header === "VIDEO" ? "video (.mp4)" : "photo (.jpg / .png)"} link (https://…)`} />
            )}
          </>
        )}
        <div className="row wrap" style={{ gap: 8 }}>
          {t && <button type="button" className="btn crm-wa" disabled={busy || (needsMedia && !shownMedia)} onClick={() => post({ op: "wa_template", template: tpl, mediaUrl: media.trim() })}>{busy ? "Sending…" : `Send on WhatsApp`}</button>}
          <a className="btn btn-outline" href={telLink(mobile)}>Call {mobile}</a>
          <a className="btn btn-outline" href={waLink(mobile)} target="_blank" rel="noopener noreferrer">Open in WhatsApp app</a>
        </div>
      </div>
      {msg && <p className={`small ${msg.ok ? "t-credit" : "t-debit"}`} role="status" style={{ margin: 0 }}>{msg.text}</p>}
    </div>
  );
}
