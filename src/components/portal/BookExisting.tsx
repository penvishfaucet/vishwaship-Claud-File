"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatINR } from "@/lib/money";
import { carrierLogo } from "@/lib/site";

type Offer = { quoteId: string; carrierCode: string; carrierName: string; serviceName: string; mode: string; etaDays?: number; chargeableWeightGrams: number; total: number; isDemo: boolean };

export function BookExisting({ orderId, held }: { orderId: string; held: boolean }) {
  const router = useRouter();
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
  async function book() {
    setBusy(true); setErr(null);
    const r = await fetch(`/api/portal/orders/${orderId}/book`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ quoteId: sel }) });
    const j = await r.json(); setBusy(false);
    if (!r.ok && r.status !== 202) { setErr(j.error?.message ?? "Booking failed"); return; }
    router.refresh();
  }
  return (
    <section className="card mb16" style={{ padding: 16 }}>
      <div className="row between"><b>Not booked yet</b>{!offers && <button className="btn btn-orange btn-sm" onClick={quote} disabled={busy}>{busy ? "Getting rates…" : "Choose courier"}</button>}</div>
      {offers && offers.length === 0 && <p className="small muted">No courier services this route.</p>}
      {offers && offers.length > 0 && (
        <>
          <div className="col mt12" style={{ gap: 8 }} role="radiogroup" aria-label="Courier options">
            {offers.map((o) => (
              <label key={o.quoteId} className={`ropt${sel === o.quoteId ? " on" : ""}`} style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 0 }}>
                <input type="radio" name="q" checked={sel === o.quoteId} onChange={() => setSel(o.quoteId)} />
                {carrierLogo(o.carrierCode) && <img className="clogo-sm" src={carrierLogo(o.carrierCode)!} alt="" />}
                <span style={{ flex: 1 }}><b className="small">{o.carrierName} · {o.serviceName}</b><span className="tiny muted" style={{ display: "block" }}>{o.mode}{o.etaDays ? ` · ETA ${o.etaDays}d` : ""} · {(o.chargeableWeightGrams / 1000).toFixed(1)} kg{o.isDemo ? " · demo" : ""}</span></span>
                <b>{formatINR(o.total)}</b>
              </label>
            ))}
          </div>
          <button className="btn btn-orange mt12" onClick={book} disabled={busy || !sel}>{busy ? "Booking…" : "Book Shipment"}</button>
        </>
      )}
      {err && <p className="err small" role="alert">{err}</p>}
    </section>
  );
}
