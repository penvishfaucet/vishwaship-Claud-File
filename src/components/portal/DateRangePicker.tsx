"use client";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { CalendarDays } from "lucide-react";

/** Date range for the dashboard (IST days). Keeps the current tab and other params in the URL. */
export function DateRangePicker({ from, to }: { from: string; to: string }) {
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  const go = (a: string, b: string) => {
    const p = new URLSearchParams(params.toString());
    p.set("from", a); p.set("to", b); p.delete("page");
    setOpen(false); router.push(`${path}?${p.toString()}`);
  };
  const preset = (days: number) => go(new Date(new Date(`${today}T00:00:00Z`).getTime() - (days - 1) * 86400_000).toISOString().slice(0, 10), today);
  const fmt = (d: string) => d.split("-").reverse().join("-");
  return (
    <div className="drp" style={{ position: "relative" }}>
      <button type="button" className="drp-btn" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}>
        <CalendarDays size={18} aria-hidden /><span>{fmt(from)} to {fmt(to)}</span>
      </button>
      {open && (
        <div className="dropdown drp-pop" role="dialog" aria-label="Choose date range">
          <div className="row wrap" style={{ gap: 6 }}>
            {[[7, "Last 7 days"], [30, "Last 30 days"], [90, "Last 90 days"]].map(([d, l]) => <button key={d} type="button" className="btn btn-sm btn-outline" onClick={() => preset(Number(d))}>{l}</button>)}
          </div>
          <div className="row wrap mt8" style={{ gap: 8, alignItems: "end" }}>
            <div className="field"><label htmlFor="drf">From</label><input id="drf" type="date" className="input" value={f} max={t} onChange={(e) => setF(e.target.value)} /></div>
            <div className="field"><label htmlFor="drt">To</label><input id="drt" type="date" className="input" value={t} min={f} max={today} onChange={(e) => setT(e.target.value)} /></div>
            <button type="button" className="btn btn-orange btn-sm" disabled={!f || !t || f > t} onClick={() => go(f, t)}>Apply</button>
          </div>
        </div>
      )}
    </div>
  );
}
