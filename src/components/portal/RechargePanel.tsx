"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatINR } from "@/lib/money";

declare global { interface Window { Razorpay?: new (o: Record<string, unknown>) => { open: () => void } } }

function loadCheckout(): Promise<void> {
  return new Promise((res, rej) => {
    if (window.Razorpay) return res();
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => res(); s.onerror = () => rej(new Error("Could not load Razorpay Checkout"));
    document.body.appendChild(s);
  });
}

export function RechargePanel({ open, razorpayConfigured }: { open: boolean; razorpayConfigured: boolean }) {
  const [amount, setAmount] = useState("1000");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; err?: string } | null>(null);
  const router = useRouter();

  async function start() {
    const rupees = Number(amount);
    if (!(rupees >= 100 && rupees <= 200000)) { setMsg({ err: "Enter an amount between ₹100 and ₹2,00,000." }); return; }
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/portal/recharge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ amountRupees: rupees }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error?.message ?? "Could not start recharge");
      if (j.mode === "demo") { setMsg({ ok: `Demo recharge of ${formatINR(j.amountPaise)} credited.` }); router.refresh(); return; }
      await loadCheckout();
      const rz = new window.Razorpay!({
        key: j.keyId, order_id: j.razorpayOrderId, amount: j.amountPaise, currency: "INR", name: "Vishwaship", description: "Wallet recharge",
        handler: async (resp: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => {
          const v = await fetch("/api/portal/recharge/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(resp) });
          const vj = await v.json();
          setMsg(v.ok ? { ok: vj.message } : { err: vj.error?.message ?? "Verification pending — your wallet will update once Razorpay confirms." });
          router.refresh();
        },
        theme: { color: "#f0712c" },
      });
      rz.open();
    } catch (e) { setMsg({ err: (e as Error).message }); } finally { setBusy(false); }
  }

  return (
    <div className="card" style={{ padding: 16 }} id="recharge">
      <form className="row wrap" style={{ gap: 8, alignItems: "end" }} onSubmit={(e) => { e.preventDefault(); start(); }}>
        <div className="field" style={{ flex: 1, minWidth: 140 }}>
          <label htmlFor="ramt">Recharge amount (₹)</label>
          <input id="ramt" className="input" type="number" min={100} step={1} value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus={open} />
        </div>
        <button className="btn btn-orange" disabled={busy}>{busy ? "Starting…" : "Recharge"}</button>
      </form>
      <div className="pills mt8">{[500, 1000, 2500, 5000].map((v) => <button type="button" key={v} className="pill" onClick={() => setAmount(String(v))}>₹{v.toLocaleString("en-IN")}</button>)}</div>
      {!razorpayConfigured && <p className="tiny muted mt8"><span className="demo-badge">DEMO</span> Razorpay isn’t connected yet, so recharges are simulated and marked as demo in your passbook.</p>}
      {msg?.ok && <p className="small mt8 t-credit" role="status">{msg.ok}</p>}
      {msg?.err && <p className="small mt8 err" role="alert">{msg.err}</p>}
    </div>
  );
}
