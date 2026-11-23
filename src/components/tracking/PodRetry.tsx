"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

/** Admin: ask the courier for the POD again now. */
export function PodRetry({ shipmentId }: { shipmentId: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  return (
    <span className="row" style={{ gap: 8, alignItems: "center" }}>
      <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={async () => {
        setBusy(true); setMsg(null);
        const r = await fetch(`/api/admin/shipments/${shipmentId}/pod`, { method: "POST" });
        const j = await r.json().catch(() => ({}));
        setMsg(r.ok ? `POD: ${j.state}` : j.error?.message ?? "Failed");
        setBusy(false); router.refresh();
      }}>{busy ? "Fetching…" : "Fetch POD now"}</button>
      {msg && <span className="small muted">{msg}</span>}
    </span>
  );
}
