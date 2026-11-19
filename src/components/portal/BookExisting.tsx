"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatINR } from "@/lib/money";
import { carrierLogo } from "@/lib/site";

type Offer = { quoteId: string; carrierCode: string; carrierName: string; serviceName: string; mode: string; etaDays?: number; chargeableWeightGrams: number; total: number; isDemo: boolean; isPilot?: boolean; partnerCode?: string | null; pending?: string | null };

export function BookExisting({ orderId, held, autoAssign = false }: { orderId: string; held: boolean; autoAssign?: boolean }) {
  const router = useRouter();
  const [auto, setAuto] = useState<{ quoteId: string; carrierName: string; serviceName: string; total: number; reason: string } | null>(null);
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (held) return <p className="note small">Waiting for the buyer to confirm this COD order on WhatsApp. It can be booked once confirmed.</p>;
  async function quote() {
    setBusy(true); setErr(null);
    const r = await fetch(`/api/portal/orders/${orderId}/quote`, { method: "POST" });
    const j = await r.json(); setBusy(false);
    if (!r.ok) { setErr(j.error?.message ?? "Could not get rates"); return; }
    setOffers(j.offers); setSel(j.offers[0]?.quoteId ?? null);
  }
  async function runAuto() {
    setBusy(true); setErr(null);
    const r = await fetch(`/api/portal/orders/${orderId}/auto-assign`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ book: false }) });
    const j = await r.json(); setBusy(false);
    if (!r.ok) { setErr(j.error?.message ?? "Could not auto-assign"); return; }
    setAuto(j); setSel(j.quoteId);
  }
  async function book(quoteId = sel) {
    setBusy(true); setErr(null);
    const r = await fetch(`/api/portal/orders/${orderId}/book`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ quoteId }) });
    const j = await r.json(); setBusy(false);
    if (j.error?.code === "price_changed") {
      if (confirm(`${j.error.message}

Book at ${formatINR(j.error.newTotal)}?`)) return book(j.error.newQuoteId);
      setErr("Not booked — the courier's price changed. Confirm the new price or choose another courier."); return;
    }
    if (!r.ok && r.status !== 202) { setErr(j.error?.message ?? "Booking failed"); return; }
    router.refresh();
  }
  return (
    <section className="card mb16" style={{ padding: 16 }}>
      <div className="row between wrap" style={{ gap: 8 }}><b>Courier not assigned yet</b>{!offers && !auto && <span className="row" style={{ gap: 8 }}>{autoAssign && <button className="btn btn-navy btn-sm" onClick={runAuto} disabled={busy}>Auto-assign</button>}<button className="btn btn-orange btn-sm" onClick={quote} disabled={busy}>{busy ? "Getting rates…" : "Assign Courier"}</button></span>}</div>
      {auto && !offers && (
        <div className="note small mt8">
          <b>{auto.carrierName} · {auto.serviceName}</b> — ₹{(auto.total / 100).toFixed(2)} incl. GST
          <div className="tiny muted" style={{ margin: "4px 0 8px" }}>Why: {auto.reason}</div>
          <span className="row" style={{ gap: 8 }}><button className="btn btn-orange btn-sm" disabled={busy} onClick={() => book(auto.quoteId)}>{busy ? "Booking…" : `Book with ${auto.carrierName}`}</button><button className="btn btn-outline btn-sm" disabled={busy} onClick={() => { setAuto(null); quote(); }}>Choose another courier</button></span>
        </div>
      )}
      {offers && offers.length === 0 && <p className="small muted">No courier services this route.</p>}
      {offers && offers.length > 0 && (
        <>
          <div className="col mt12" style={{ gap: 8 }} role="radiogroup" aria-label="Courier options">
            {offers.map((o) => (
              <label key={o.quoteId} className={`ropt${sel === o.quoteId ? " on" : ""}`} style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 0 }}>
                <input type="radio" name="q" checked={sel === o.quoteId} onChange={() => setSel(o.quoteId)} disabled={!!o.pending} />
                {carrierLogo(o.carrierCode) && <img className="clogo-sm" src={carrierLogo(o.carrierCode)!} alt="" />}
                <span style={{ flex: 1 }}><b className="small">{o.carrierName} · {o.serviceName}</b><span className="tiny muted" style={{ display: "block" }}>{o.mode}{o.etaDays ? ` · ETA ${o.etaDays}d` : ""} · {(o.chargeableWeightGrams / 1000).toFixed(1)} kg{o.isDemo ? " · demo" : ""}{o.isPilot ? " · verification" : ""}{o.partnerCode ? ` · Partner code ${o.partnerCode}` : ""}</span>{o.pending && <span className="tiny" role="note" style={{ display: "block", color: "#a83a00", fontWeight: 600 }}>Rate pending confirmation — {o.pending}. Not bookable yet.</span>}</span>
                <b>{formatINR(o.total)}</b>
              </label>
            ))}
          </div>
          <button className="btn btn-orange mt12" onClick={() => book()} disabled={busy || !sel}>{busy ? "Booking…" : "Assign Courier & Book"}</button>
        </>
      )}
      {err && <p className="err small" role="alert">{err}</p>}
    </section>
  );
}
