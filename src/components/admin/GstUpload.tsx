"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** File upload to /api/admin/gst: a courier bill import (CSV / XLSX) or the original PDF of one bill. */
export function GstUpload({ mode, billId, label, accept }: { mode: "import" | "pdf"; billId?: string; label: string; accept: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();
  return (
    <form className="row wrap" style={{ gap: 8, alignItems: "center" }} onSubmit={async (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      fd.set("mode", mode);
      if (billId) fd.set("billId", billId);
      setBusy(true); setMsg(null);
      const r = await fetch("/api/admin/gst", { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      setBusy(false);
      setMsg(r.ok ? { ok: true, text: j.message ?? "Uploaded" } : { ok: false, text: j.error?.message ?? "Upload failed" });
      if (r.ok) { e.currentTarget?.reset?.(); router.refresh(); }
    }}>
      <input type="file" name="file" accept={accept} required className="input" style={{ maxWidth: 280 }} aria-label={label} />
      <button className="btn btn-sm btn-orange" disabled={busy}>{busy ? "Uploading…" : label}</button>
      {msg && <span className={`small ${msg.ok ? "t-credit" : "t-debit"}`} role="status" style={{ flexBasis: "100%" }}>{msg.text}</span>}
    </form>
  );
}
