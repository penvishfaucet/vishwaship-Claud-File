"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function DisputeButtons({ id, status, fod }: { id: string; status: string; fod?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const router = useRouter();
  async function run(op: "charge" | "waive") {
    if (!confirm(op === "charge" ? (fod ? "Keep the courier weight? (FoD: the receiver pays at delivery; nothing is charged to the wallet)" : "Charge this weight difference to the customer’s wallet?") : fod ? "Courier accepted the dispute? The receiver’s freight goes back to the original amount." : "Waive this discrepancy?")) return;
    setBusy(true); setMsg("");
    const r = await fetch(`/api/admin/disputes/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ op }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false); setMsg(r.ok ? j.message : j.error?.message ?? "Failed");
    if (r.ok) router.refresh();
  }
  return (
    <span className="row wrap" style={{ gap: 6 }}>
      {status !== "charged" && status !== "accepted" && <button type="button" className="btn btn-sm btn-navy" disabled={busy} onClick={() => run("charge")}>{fod ? "Courier weight stands" : "Charge"}</button>}
      <button type="button" className="btn btn-sm btn-outline" disabled={busy} onClick={() => run("waive")}>{fod ? "Dispute accepted" : "Waive"}</button>
      {msg && <span className="tiny" role="status">{msg}</span>}
    </span>
  );
}
