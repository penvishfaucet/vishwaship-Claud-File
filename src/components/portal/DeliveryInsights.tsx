"use client";
import { useEffect, useState } from "react";
import { ShieldAlert, ShieldCheck, ShieldQuestion, UserRound } from "lucide-react";

export type CarrierStat = { carrierCode: string; carrierName: string; delivered: number; rto: number; finished: number; deliveredPct: number; rtoPct: number; scope: "pin" | "area" };
export type BuyerStat = { orders: number; finished: number; delivered: number; returned: number; codOrders: number; codDelivered: number; codReturned: number; codRejectedOnWhatsapp: number; acceptPct: number | null; label: "new" | "trusted" | "watch" | "risky" };
export type Insights = { carriers: Record<string, CarrierStat>; buyer: BuyerStat | null };

/** Loads delivery insights for the delivery PIN and the buyer's mobile (cached by the browser for 5 minutes). */
export function useInsights(pin: string, mobile: string, on: boolean) {
  const [data, setData] = useState<Insights | null>(null);
  useEffect(() => {
    if (!on || !/^[1-9]\d{5}$/.test(pin)) return;
    let live = true;
    fetch(`/api/portal/insights/?pin=${pin}&mobile=${encodeURIComponent(mobile.replace(/\D/g, "").slice(-10))}`).then((r) => (r.ok ? r.json() : null)).then((j) => { if (live && j) setData(j); }).catch(() => undefined);
    return () => { live = false; };
  }, [pin, mobile, on]);
  return data;
}

const LABEL = {
  new: { text: "New buyer", cls: "new", Icon: ShieldQuestion, tip: "No delivery history on Vishwaship yet." },
  trusted: { text: "Trusted buyer", cls: "ok", Icon: ShieldCheck, tip: "Usually accepts delivery." },
  watch: { text: "Watch", cls: "warn", Icon: ShieldQuestion, tip: "Mixed history — confirm before shipping COD." },
  risky: { text: "High RTO risk", cls: "bad", Icon: ShieldAlert, tip: "Often refuses or returns — prefer prepaid." },
} as const;

/** Buyer card shown above the courier list. */
export function BuyerInsight({ buyer, cod }: { buyer: BuyerStat | null; cod: boolean }) {
  if (!buyer) return null;
  const l = LABEL[buyer.label];
  const take = buyer.acceptPct;
  return (
    <div className={`di-buyer ${l.cls}`} role="note">
      <span className="di-ic"><l.Icon size={22} aria-hidden /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="di-top"><UserRound size={14} aria-hidden /> <b>Buyer record</b> <span className={`di-chip ${l.cls}`}>{l.text}</span></div>
        {buyer.label === "new" ? <p>{l.tip}{cod ? " For a first COD order, WhatsApp COD confirmation helps." : ""}</p> : (
          <>
            <div className="di-bar" aria-hidden><i style={{ width: `${take ?? 0}%` }} /></div>
            <p><b>{take}%</b> chance to accept · {buyer.delivered} of {buyer.finished + buyer.codRejectedOnWhatsapp} orders taken{buyer.returned ? `, ${buyer.returned} returned` : ""}{buyer.codRejectedOnWhatsapp ? `, ${buyer.codRejectedOnWhatsapp} cancelled on WhatsApp` : ""}.
              {buyer.codOrders > 0 && <> COD: {buyer.codDelivered} delivered, {buyer.codReturned} returned.</>} {l.tip}</p>
          </>
        )}
      </div>
    </div>
  );
}

/** Line under a courier rate: its delivery and RTO rate on this PIN (or area). */
export function CarrierInsight({ stat, best }: { stat?: CarrierStat; best: boolean }) {
  if (!stat) return <span className="di-line muted">New on this PIN — no delivery history yet</span>;
  return (
    <span className={`di-line${best ? " best" : ""}`}>
      <span className={stat.deliveredPct >= 90 ? "g" : stat.deliveredPct >= 75 ? "a" : "r"}>Delivered {stat.deliveredPct}%</span>
      <span> · RTO {stat.rtoPct}%</span>
      <span className="muted"> · {stat.finished} shipments {stat.scope === "pin" ? "to this PIN" : "in this area"}</span>
      {best && <span className="di-best">Best delivery here</span>}
    </span>
  );
}
