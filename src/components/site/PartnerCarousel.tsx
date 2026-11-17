"use client";
import { useEffect, useState } from "react";
import type { Partner } from "@/lib/site-content";

/**
 * Shared courier-partner logo carousel (Home + Rate Calculator). Records come from Admin → Website Content → Partners.
 * Continuous scroll; pauses on hover, keyboard focus or touch; Pause button for everyone; reduced-motion users
 * (or a paused carousel) get a static row they can scroll by hand. The duplicate loop copy is hidden from AT.
 */
export function PartnerCarousel({ partners, heading, showCount = true, compact = false }: { partners: Partner[]; heading: string; showCount?: boolean; compact?: boolean }) {
  const [paused, setPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [touchHold, setTouchHold] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  useEffect(() => {
    if (!touchHold) return;
    const t = setTimeout(() => setTouchHold(false), 4000);
    return () => clearTimeout(t);
  }, [touchHold]);

  const unique = partners.filter((p, i, a) => a.findIndex((x) => x.name.toLowerCase() === p.name.toLowerCase()) === i);
  if (unique.length === 0) return null;
  const moving = !reduced && !paused;
  // ~4.4 s per logo keeps the speed constant however many partners are published
  const duration = `${Math.max(20, unique.length * 4.4)}s`;

  const logo = (p: Partner, dup: boolean) => {
    const img = <img src={p.logoUrl} alt={dup ? "" : p.name} loading="lazy" decoding="async" draggable={false} />;
    return (
      <li key={`${p.id}${dup ? "-d" : ""}`} className="pc-item" aria-hidden={dup || undefined}>
        {p.link ? <a href={p.link} target="_blank" rel="noopener noreferrer" tabIndex={dup ? -1 : undefined} title={p.name}>{img}</a> : <span title={p.name}>{img}</span>}
      </li>
    );
  };

  return (
    <section className={`pc${compact ? " pc-compact" : ""}`} aria-labelledby="pc-h">
      <div className="pc-head">
        <h2 id="pc-h" className="pc-title">{heading}{showCount && <span className="pc-count">{unique.length} partners</span>}</h2>
        {!reduced && (
          <button type="button" className="pc-toggle" onClick={() => setPaused((v) => !v)} aria-pressed={paused}>
            {paused ? "Play" : "Pause"}<span className="sr-only"> partner logos</span>
          </button>
        )}
      </div>
      <div
        className={`pc-viewport${moving ? "" : " pc-static"}${touchHold ? " pc-hold" : ""}`}
        onTouchStart={() => setTouchHold(true)}
        tabIndex={moving ? undefined : 0}
        aria-label={moving ? undefined : "Courier partner logos, scroll sideways"}
        role={moving ? undefined : "region"}
      >
        <ul className="pc-track" style={moving ? { animationDuration: duration } : undefined}>
          {unique.map((p) => logo(p, false))}
          {moving && unique.map((p) => logo(p, true))}
        </ul>
      </div>
      <p className="pc-note">Courier availability depends on serviceability and the services enabled on your account.</p>
    </section>
  );
}
