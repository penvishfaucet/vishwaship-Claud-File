"use client";
import { useState } from "react";

/** Admin → Integrations: shows where uploaded documents are kept and runs a live upload/download test. */
export function StorageTest({ driver, bucket, canTest }: { driver: "s3" | "disk"; bucket: string | null; canTest: boolean }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ ok: boolean; message: string } | null>(null);
  async function run() {
    setBusy(true);
    setRes(null);
    try {
      const r = await fetch("/api/admin/storage/", { method: "POST" });
      const j = await r.json();
      setRes(r.ok ? { ok: j.ok, message: j.message } : { ok: false, message: j?.error?.message ?? `HTTP ${r.status}` });
    } catch {
      setRes({ ok: false, message: "Could not reach the server" });
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card mb16" style={{ padding: 16 }}>
      <div className="row between" style={{ gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ fontSize: 16, margin: 0 }}>File storage (KYC and other documents)</h2>
          <p className="small muted" style={{ margin: "4px 0 0" }}>
            {driver === "s3"
              ? <>Private bucket <b>{bucket}</b> — files are encrypted and kept across deploys.</>
              : <>Local disk — <b>files are lost on every redeploy</b>. Set the S3_* environment variables to use a bucket.</>}
          </p>
        </div>
        {canTest && <button type="button" className="btn btn-outline btn-sm" onClick={run} disabled={busy}>{busy ? "Testing…" : "Test file storage"}</button>}
      </div>
      {res && <p className={`small ${res.ok ? "t-credit" : "err"}`} role="status" style={{ marginTop: 8 }}>{res.ok ? "✓ " : "✗ "}{res.message}</p>}
    </section>
  );
}
