"use client";
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import type { Partner } from "@/lib/site-content";

/**
 * Shared courier-partner logo carousel (Home + Rate Calculator). Records come from Admin → Website Content → Partners.
 * One row that scrolls by itself and can also be swiped / scrolled by hand (it is a real scroll container).
 * Pauses on hover, keyboard focus and touch (resumes a few seconds after the finger lifts); Pause button for
 * everyone; reduced-motion visitors get the same row without automatic movement. The loop copy is hidden from AT.
 */
export function PartnerCarousel({ partners, heading, showCount = true, compact = false, bare = false, strip = false }: { partners: Partner[]; heading: string; showCount?: boolean; compact?: boolean; bare?: boolean; strip?: boolean }) {
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  const vp = useRef<HTMLDivElement>(null);
  const hold = useRef({ hover: false, focus: false, touchUntil: 0 });

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  const unique = partners.filter((p, i, a) => a.findIndex((x) => x.name.toLowerCase() === p.name.toLowerCase()) === i);
  const auto = !reduced && !paused && unique.length > 1;

  useEffect(() => {
    const el = vp.current;
    if (!el || !auto) return;
    let raf = 0, last = performance.now(), carry = 0;
    const step = (t: number) => {
      const dt = Math.min(64, t - last); last = t;
      const h = hold.current;
      if (!h.hover && !h.focus && Date.now() > h.touchUntil) {
        carry += dt * 0.045; // ≈ 45 px per second
        const px = Math.floor(carry);
        if (px) { carry -= px; el.scrollLeft += px; }
        const half = el.scrollWidth / 2;
        if (el.scrollLeft >= half) el.scrollLeft -= half;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [auto, unique.length]);

  if (unique.length === 0) return null;
  const nudge = (dir: 1 | -1) => {
    const el = vp.current; if (!el) return;
    hold.current.touchUntil = Date.now() + 4000;
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: reduced ? "auto" : "smooth" });
  };

  const logo = (p: Partner, dup: boolean) => {
    const img = <img src={p.logoUrl} alt={dup ? "" : p.name} loading="lazy" decoding="async" draggable={false} />;
    return (
      <li key={`${p.id}${dup ? "-d" : ""}`} className="pc-item" aria-hidden={dup || undefined}>
        {p.link ? <a href={p.link} target="_blank" rel="noopener noreferrer" tabIndex={dup ? -1 : undefined} title={p.name}>{img}</a> : <span title={p.name}>{img}</span>}
      </li>
    );
  };

  return (
    <section className={`pc${compact ? " pc-compact" : ""}${bare || strip ? " pc-bare" : ""}${strip ? " pc-strip" : ""}`} aria-labelledby="pc-h">
      {strip ? <h2 id="pc-h" className="sr-only">{heading}</h2> : <div className="pc-head">
        <h2 id="pc-h" className="pc-title">{heading}{showCount && <span className="pc-count">{unique.length} partners</span>}</h2>
        {!reduced && (
          <button type="button" className="pc-toggle" onClick={() => setPaused((v) => !v)} aria-pressed={paused}>
            {paused ? "Play" : "Pause"}<span className="sr-only"> partner logos</span>
          </button>
        )}
      </div>}
      <div className="pc-row">
        <button type="button" className="pc-arrow" aria-label="Previous partners" onClick={() => nudge(-1)}><ChevronLeft size={22} aria-hidden="true" /></button>
        <div
          ref={vp}
          className={`pc-viewport${auto ? " pc-auto" : ""}`}
          tabIndex={0}
          role="region"
          aria-label="Courier partner logos — scroll sideways"
          onMouseEnter={() => { hold.current.hover = true; }}
          onMouseLeave={() => { hold.current.hover = false; }}
          onFocus={() => { hold.current.focus = true; }}
          onBlur={() => { hold.current.focus = false; }}
          onTouchStart={() => { hold.current.touchUntil = Date.now() + 60_000; }}
          onTouchEnd={() => { hold.current.touchUntil = Date.now() + 3000; }}
          onWheel={() => { hold.current.touchUntil = Date.now() + 3000; }}
        >
          <ul className="pc-track">
            {unique.map((p) => logo(p, false))}
            {auto && unique.map((p) => logo(p, true))}
          </ul>
        </div>
        <button type="button" className="pc-arrow" aria-label="Next partners" onClick={() => nudge(1)}><ChevronRight size={22} aria-hidden="true" /></button>
        {strip && !reduced && (
          <button type="button" className="pc-arrow pc-pause" onClick={() => setPaused((v) => !v)} aria-pressed={paused} aria-label={paused ? "Play partner logos" : "Pause partner logos"} title={paused ? "Play" : "Pause"}>
            {paused ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
          </button>
        )}
      </div>
      {!strip && <p className="pc-note">Courier availability depends on serviceability and the services enabled on your account.</p>}
    </section>
  );
}
