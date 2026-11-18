"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Upload } from "lucide-react";

/** Customer reply to "More Information Required" — message and/or a new payment screenshot. */
export function RechargeInfoForm({ id }: { id: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!msg.trim() && !file) { setNote({ ok: false, text: "Add a message or a new screenshot." }); return; }
    setBusy(true); setNote(null);
    const fd = new FormData(); fd.set("message", msg); if (file) fd.set("file", file);
    const r = await fetch(`/api/portal/recharge/${id}/info/`, { method: "POST", body: fd });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    setNote(r.ok ? { ok: true, text: j.message } : { ok: false, text: j.error?.message ?? "Could not send" });
    if (r.ok) { setMsg(""); setFile(null); router.refresh(); }
  }
  return (
    <form onSubmit={send} className="card col" style={{ padding: 16, gap: 10 }}>
      <h2 style={{ fontSize: 16, margin: 0 }}>Provide the requested information</h2>
      <div className="field"><label htmlFor="ri-msg">Message</label><textarea id="ri-msg" className="textarea" rows={3} maxLength={2000} value={msg} onChange={(e) => setMsg(e.target.value)} /></div>
      <label className="rc-drop"><Upload size={18} aria-hidden /><span>{file ? file.name : "Upload a new screenshot (optional)"}</span><input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></label>
      {note && <p className={`small ${note.ok ? "t-credit" : "err"}`} role="status">{note.text}</p>}
      <button className="btn btn-orange" disabled={busy} style={{ alignSelf: "start" }}>{busy ? "Sending…" : "Send to Vishwaship"}</button>
    </form>
  );
}
