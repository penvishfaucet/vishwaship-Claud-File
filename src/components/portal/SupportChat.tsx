"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Layers, MessageCircleMore, Paperclip, SendHorizontal, Ticket, X } from "lucide-react";
import { OPEN_CHAT_EVENT } from "./quick-actions";

type Recent = { id: string; number: string; subject: string; status: string; updatedAt: string };

/** Header "Support Chat": bottom sheet on phones, side panel on desktop. A message starts (or continues) a chat ticket. */
export function SupportChat({ open: openCount, recent }: { open: number; recent: Recent[] }) {
  const router = useRouter();
  const [show, setShow] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const o = () => setShow(true);
    window.addEventListener(OPEN_CHAT_EVENT, o);
    return () => window.removeEventListener(OPEN_CHAT_EVENT, o);
  }, []);
  useEffect(() => {
    if (!show) return;
    const t = setTimeout(() => input.current?.focus(), 80);
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setShow(false); };
    document.addEventListener("keydown", esc);
    return () => { clearTimeout(t); document.removeEventListener("keydown", esc); };
  }, [show]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const m = text.trim();
    if (m.length < 2) return;
    setBusy(true); setErr(null);
    const r = await fetch("/api/portal/support/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: m }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(j.error?.message ?? "Could not send"); return; }
    setText(""); setShow(false);
    router.push(`/portal/support/${j.ticketId}/`);
  }

  return (
    <>
      <button type="button" className="hdr-ico hchat" aria-label={`Support chat${openCount ? `, ${openCount} open tickets` : ""}`} aria-expanded={show} onClick={() => setShow(true)}>
        <MessageCircleMore size={19} aria-hidden /><span className="hide-md">Support</span>{openCount > 0 && <i>{openCount > 9 ? "9+" : openCount}</i>}
      </button>
      {show && (
        <div className="sc-backdrop" onClick={() => setShow(false)}>
          <section className="sc-sheet" role="dialog" aria-modal="true" aria-label="Support chat" onClick={(e) => e.stopPropagation()}>
            <span className="sc-grip" aria-hidden />
            <header className="sc-h"><MessageCircleMore size={24} aria-hidden /><h2>Support Chat</h2><button type="button" className="sc-x" aria-label="Close" onClick={() => setShow(false)}><X size={22} /></button></header>
            <div className="sc-body">
              <p className="sc-bubble">Hi! How can we help you today?</p>
              <div className="sc-quick">
                <Link href="/portal/support/new/" onClick={() => setShow(false)}><Ticket size={18} aria-hidden /> Raise a ticket</Link>
                <Link href="/portal/support/" onClick={() => setShow(false)}><Layers size={18} aria-hidden /> View my tickets</Link>
              </div>
              {recent.length > 0 && (
                <div className="sc-recent">
                  <p className="tiny muted">Recent conversations</p>
                  {recent.slice(0, 4).map((t) => (
                    <Link key={t.id} href={`/portal/support/${t.id}/`} onClick={() => setShow(false)}>
                      <span>{t.subject}</span><span className={`sc-st ${t.status}`}>{t.status.replace(/_/g, " ")}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
            <form className="sc-input" onSubmit={send}>
              <Link href="/portal/support/new/" className="sc-attach" aria-label="Raise a ticket with attachment" onClick={() => setShow(false)}><Paperclip size={20} aria-hidden /></Link>
              <label className="sr-only" htmlFor="sc-msg">Message</label>
              <input id="sc-msg" ref={input} value={text} onChange={(e) => setText(e.target.value)} placeholder="Type a message" maxLength={2000} autoComplete="off" />
              <button type="submit" className="sc-send" aria-label="Send" disabled={busy || text.trim().length < 2}><SendHorizontal size={20} aria-hidden /></button>
            </form>
            {err && <p className="small err" role="alert" style={{ margin: "6px 16px 12px" }}>{err}</p>}
          </section>
        </div>
      )}
    </>
  );
}
