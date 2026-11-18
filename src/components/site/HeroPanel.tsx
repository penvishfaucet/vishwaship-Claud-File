"use client";
import { useEffect, useRef, useState } from "react";
import { Box, MapPin, Search } from "lucide-react";

const KEY = "vs-hero-panel";
type Saved = { o: string; d: string; w: string; awb: string };

/**
 * Floating Calculate Rates / Track Shipment panel on the Home hero.
 * Get Rates opens the full Rate Calculator with these values (?o=&d=&w=) — it adds carton size and payment,
 * then quotes from the shared backend. Track opens /track/?awb=. Values are kept in this tab while browsing.
 */
export function HeroPanel({ showCalc, showTrack, threshold }: { showCalc: boolean; showTrack: boolean; threshold: number }) {
  const [tab, setTab] = useState<"calc" | "track">(showCalc ? "calc" : "track");
  const [v, setV] = useState<Saved>({ o: "", d: "", w: "", awb: "" });
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  useEffect(() => {
    try { const s = JSON.parse(sessionStorage.getItem(KEY) ?? "null") as Saved | null; if (s) setV((x) => ({ ...x, ...s })); } catch { /* storage blocked */ }
  }, []);
  const upd = (patch: Partial<Saved>) => setV((x) => {
    const n = { ...x, ...patch };
    try { sessionStorage.setItem(KEY, JSON.stringify(n)); } catch { /* ignore */ }
    return n;
  });
  if (!showCalc && !showTrack) return null;
  const list = [showCalc && ["calc", "Calculate Rates"], showTrack && ["track", "Track Shipment"]].filter(Boolean) as Array<["calc" | "track", string]>;
  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const j = (i + (e.key === "ArrowRight" ? 1 : -1) + list.length) % list.length;
    setTab(list[j][0]); tabs.current[j]?.focus();
  };
  return (
    <div className="w-panel">
      <div className="w-tabs" role="tablist" aria-label="Rates and tracking">
        {list.map(([k, l], i) => (
          <button key={k} ref={(el) => { tabs.current[i] = el; }} type="button" role="tab" id={`hp-tab-${k}`} aria-selected={tab === k} aria-controls={`hp-${k}`} tabIndex={tab === k ? 0 : -1}
            onClick={() => setTab(k)} onKeyDown={(e) => onKey(e, i)}>{l}</button>
        ))}
      </div>
      {showCalc && (
        <form id="hp-calc" role="tabpanel" aria-labelledby="hp-tab-calc" hidden={tab !== "calc"} className="w-pf" action="/shipping-rate-calculator/" method="get">
          <div className="w-pin">
            <label htmlFor="hp-o">Pickup PIN</label>
            <span className="ic"><MapPin size={18} aria-hidden="true" /><input id="hp-o" name="o" inputMode="numeric" pattern="[1-9][0-9]{5}" maxLength={6} placeholder="Pickup PIN" required value={v.o} onChange={(e) => upd({ o: e.target.value.replace(/\D/g, "") })} title="6-digit PIN code" /></span>
          </div>
          <div className="w-pin">
            <label htmlFor="hp-d">Delivery PIN</label>
            <span className="ic"><MapPin size={18} aria-hidden="true" /><input id="hp-d" name="d" inputMode="numeric" pattern="[1-9][0-9]{5}" maxLength={6} placeholder="Delivery PIN" required value={v.d} onChange={(e) => upd({ d: e.target.value.replace(/\D/g, "") })} title="6-digit PIN code" /></span>
          </div>
          <div className="w-pin">
            <label htmlFor="hp-w">Weight (kg)</label>
            <span className="ic"><Box size={18} aria-hidden="true" /><input id="hp-w" name="w" inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,3})?" placeholder="Weight (kg)" required value={v.w} onChange={(e) => upd({ w: e.target.value.replace(/[^\d.]/g, "") })} aria-describedby="hp-wh" /></span>
          </div>
          <button className="w-btn pri" type="submit">Get Rates</button>
          <p id="hp-wh" className="w-ph">Under {threshold} kg → parcel (B2C) · {threshold} kg or more → cargo (B2B). Add carton size on the next step.</p>
        </form>
      )}
      {showTrack && (
        <form id="hp-track" role="tabpanel" aria-labelledby="hp-tab-track" hidden={tab !== "track"} className="w-pf trk" action="/track/" method="get">
          <div className="w-pin wide">
            <label htmlFor="hp-awb">AWB or LR number</label>
            <span className="ic"><Search size={18} aria-hidden="true" /><input id="hp-awb" name="awb" placeholder="Enter AWB or LR number" autoComplete="off" maxLength={40} required value={v.awb} onChange={(e) => upd({ awb: e.target.value.trim() })} /></span>
          </div>
          <button className="w-btn navy" type="submit">Track</button>
        </form>
      )}
    </div>
  );
}
