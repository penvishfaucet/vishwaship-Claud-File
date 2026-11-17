"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** Release / cancel a held COD order, or (demo mode only) simulate the buyer's button press. */
export function CodActions({ id, status, demo }: { id: string; status: string; demo: boolean }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const router = useRouter();
  async function act(decision: "confirm" | "cancel", simulate = false) {
    if (!simulate && decision === "cancel" && !confirm("Cancel this order? If it is already booked we will ask the courier to cancel it.")) return;
    setBusy(true); setMsg("");
    const r = await fetch(`/api/portal/cod/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision, simulate }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    setMsg(r.ok ? j.message : j.error?.message ?? "Failed");
    router.refresh();
  }
  const manual = ["send_failed", "no_response", "needs_review"].includes(status);
  return (
    <span className="row wrap" style={{ gap: 6 }}>
      {demo && status === "pending" && <>
        <button className="btn btn-sm btn-outline" disabled={busy} onClick={() => act("confirm", true)} title="Demo only: pretend the buyer tapped Confirm Order">Sim: Confirm</button>
        <button className="btn btn-sm btn-outline" disabled={busy} onClick={() => act("cancel", true)} title="Demo only: pretend the buyer tapped Cancel Order">Sim: Cancel</button>
      </>}
      {manual && <>
        <button className="btn btn-sm btn-navy" disabled={busy} onClick={() => act("confirm")}>Release</button>
        <button className="btn btn-sm btn-outline" disabled={busy} onClick={() => act("cancel")}>Cancel order</button>
      </>}
      {msg && <span className="tiny muted" role="status">{msg}</span>}
    </span>
  );
}
