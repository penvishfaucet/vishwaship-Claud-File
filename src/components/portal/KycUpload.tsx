"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function KycUpload({ docType, numberLabel }: { docType: string; numberLabel: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setErr(null);
    const fd = new FormData(e.currentTarget); fd.set("docType", docType);
    const r = await fetch("/api/portal/kyc", { method: "POST", body: fd });
    setBusy(false);
    if (!r.ok) { setErr((await r.json()).error?.message ?? "Upload failed"); return; }
    router.refresh();
  }
  return (
    <form className="col mt8" style={{ gap: 8 }} onSubmit={submit}>
      <div className="field"><label htmlFor={`n-${docType}`}>{numberLabel}</label><input id={`n-${docType}`} name="number" className="input" required autoComplete="off" /></div>
      {docType === "cancelled_cheque" && <div className="field"><label htmlFor="ifsc">IFSC</label><input id="ifsc" name="ifsc" className="input" required pattern="[A-Za-z]{4}0[A-Za-z0-9]{6}" /></div>}
      <div className="field"><label htmlFor={`f-${docType}`}>File</label><input id={`f-${docType}`} name="file" type="file" accept=".pdf,.jpg,.jpeg,.png" required className="input" /></div>
      {err && <p className="err small" role="alert">{err}</p>}
      <button className="btn btn-sm btn-orange" disabled={busy}>{busy ? "Uploading…" : "Upload"}</button>
    </form>
  );
}
