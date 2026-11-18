"use client";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Paperclip, SendHorizontal, X } from "lucide-react";
import { FILE_ACCEPT, FILE_HINT, MESSAGE_MAX, checkFileClient } from "@/lib/support";

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, "");

/**
 * Message box at the bottom of a ticket thread (customer or admin). A failed send keeps the draft and the
 * same message key, so pressing Send again never creates a second copy. Admin can also set the status.
 */
export function TicketComposer({ ticketId, endpoint, withStatus, currentStatus }: { ticketId: string; endpoint?: string; withStatus?: boolean; currentStatus?: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState(currentStatus === "resolved" || currentStatus === "closed" ? currentStatus : "open");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const cid = useRef(newKey());
  const inFlight = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const url = endpoint ?? `/api/portal/support/tickets/${ticketId}/messages`;
  const statusChanged = withStatus && status !== (currentStatus === "resolved" || currentStatus === "closed" ? currentStatus : "open");
  const canSend = !busy && (text.trim().length > 0 || !!file || statusChanged);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!canSend || inFlight.current) return;
    if (file) { const m = checkFileClient(file); if (m) { setErr(m); return; } }
    inFlight.current = true; setBusy(true); setErr(null);
    const fd = new FormData();
    fd.set("cid", cid.current); fd.set("body", text.trim());
    if (file) fd.set("file", file);
    if (withStatus) fd.set("status", status);
    try {
      const r = await fetch(url, { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j.error?.message ?? "Could not send. Your message is kept — tap send to retry."); return; }
      setText(""); setFile(null); if (fileInput.current) fileInput.current.value = "";
      cid.current = newKey();
      router.refresh();
    } catch {
      setErr("Network problem. Your message is kept — tap send to retry.");
    } finally { setBusy(false); inFlight.current = false; }
  }

  return (
    <form className="tk-composer" onSubmit={send}>
      {file && <p className="tk-chip"><Paperclip size={14} aria-hidden /> {file.name}<button type="button" aria-label="Remove attachment" onClick={() => { setFile(null); if (fileInput.current) fileInput.current.value = ""; }}><X size={14} /></button></p>}
      {err && <p className="rt-err" role="alert">{err}</p>}
      {withStatus && (
        <label className="tk-status small">Status
          <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="open">Open</option><option value="resolved">Resolved</option><option value="closed">Closed</option></select>
        </label>
      )}
      <div className="tk-row">
        <div className="tk-box">
          <label className="sr-only" htmlFor={`m-${ticketId}`}>Message</label>
          <textarea id={`m-${ticketId}`} rows={1} value={text} onChange={(e) => setText(e.target.value.slice(0, MESSAGE_MAX))} placeholder="Enter your message" maxLength={MESSAGE_MAX}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && window.matchMedia("(pointer: fine)").matches) { e.preventDefault(); void send(e); } }} />
          <button type="submit" className="tk-send" aria-label={busy ? "Sending" : "Send"} disabled={!canSend}><SendHorizontal size={20} aria-hidden /></button>
        </div>
        <button type="button" className="tk-attach" aria-label="Attach file" title={FILE_HINT} onClick={() => fileInput.current?.click()}><Paperclip size={20} aria-hidden /></button>
        <input ref={fileInput} type="file" accept={FILE_ACCEPT} hidden aria-label="Attach file" onChange={(e) => { const f = e.target.files?.[0] ?? null; setErr(f ? checkFileClient(f) : null); setFile(f && !checkFileClient(f) ? f : null); }} />
      </div>
    </form>
  );
}
