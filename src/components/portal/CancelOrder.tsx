"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { XCircle } from "lucide-react";

export function CancelOrder({ orderId, booked }: { orderId: string; booked: boolean }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();
  async function run() {
    if (!confirm(booked ? "Cancel this shipment? We will ask the courier to cancel it; the shipping charge is refunded to your wallet once the courier confirms." : "Cancel this order?")) return;
    setBusy(true); setMsg(null);
    const r = await fetch(`/api/portal/orders/${orderId}/cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    setMsg(r.ok ? { ok: true, text: j.message } : { ok: false, text: j.error?.message ?? "Cancellation failed" });
    if (r.ok) router.refresh();
  }
  return (
    <>
      <button type="button" className="btn btn-outline" disabled={busy} onClick={run}><XCircle size={16} /> {busy ? "Cancelling…" : "Cancel"}</button>
      {msg && <span className={`small ${msg.ok ? "t-credit" : "t-debit"}`} role="status" style={{ flexBasis: "100%", textAlign: "right" }}>{msg.text}</span>}
    </>
  );
}
