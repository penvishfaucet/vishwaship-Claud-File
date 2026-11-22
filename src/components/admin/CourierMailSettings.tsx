"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** Admin → Weight Disputes: where "Send to Delhivery" mails a client's dispute. */
export function CourierMailSettings({ to, cc }: { to: string; cc: string }) {
  const [t, setT] = useState(to);
  const [c, setC] = useState(cc);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const router = useRouter();
  return (
    <form className="card mb12" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setMsg("");
      const r = await fetch("/api/admin/disputes/courier-mail", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ to: t, cc: c }) });
      const j = await r.json().catch(() => ({}));
      setBusy(false); setMsg(r.ok ? "Saved" : j.error?.message ?? "Could not save");
      if (r.ok) router.refresh();
    }}>
      <h2 className="h3" style={{ marginTop: 0 }}>Courier dispute e-mail</h2>
      <p className="small muted" style={{ margin: "0 0 8px" }}>When a client disputes a weight, press <b>Send to Delhivery</b> on that row: the LR, both weights, the client’s reason and photo links are e-mailed to these addresses.</p>
      <div className="row wrap" style={{ gap: 8, alignItems: "flex-end" }}>
        <label className="col tiny" style={{ flex: "2 1 260px" }}>Courier dispute address(es) — To
          <input className="input" value={t} onChange={(e) => setT(e.target.value)} placeholder="name@delhivery.com, other@delhivery.com" required />
        </label>
        <label className="col tiny" style={{ flex: "1 1 200px" }}>CC (e.g. your own e-mail)
          <input className="input" value={c} onChange={(e) => setC(e.target.value)} placeholder="you@example.com" />
        </label>
        <button className="btn btn-sm btn-navy" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
        {msg && <span className="tiny" role="status">{msg}</span>}
      </div>
    </form>
  );
}
