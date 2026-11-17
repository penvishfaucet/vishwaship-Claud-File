"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { RefreshCw } from "lucide-react";

export function RefreshTracking({ shipmentId, endpoint = "/api/portal/shipments" }: { shipmentId: string; endpoint?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function go() {
    setBusy(true); setMsg(null);
    const r = await fetch(`${endpoint}/${shipmentId}/refresh`, { method: "POST" });
    const j = await r.json(); setBusy(false);
    setMsg(r.ok ? (j.inserted ? `${j.inserted} new update(s) from the carrier.` : "Already up to date.") : (j.error?.message ?? "Could not refresh"));
    router.refresh();
  }
  return (
    <div className="row mt8" style={{ gap: 8, alignItems: "center" }}>
      <button className="btn btn-sm btn-outline" onClick={go} disabled={busy}><RefreshCw size={14} /> {busy ? "Checking carrier…" : "Refresh from carrier"}</button>
      {msg && <span className="tiny muted" role="status">{msg}</span>}
    </div>
  );
}
