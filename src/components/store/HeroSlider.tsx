"use client";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

export type Slide = { heading: string; text: string; image: string | null; imageMobile?: string | null; alt?: string; buttons: Array<{ label: string; href: string }> };

/**
 * Home page sliding banner. Autoplay pauses on hover/focus, when the tab is hidden and for people who prefer
 * reduced motion; arrows, dots and swipe (scroll-snap) always work. A single slide renders as a plain banner.
 */
export function HeroSlider({ slides, intervalMs, center }: { slides: Slide[]; intervalMs: number; center: boolean }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const track = useRef<HTMLDivElement>(null);
  const n = slides.length;

  const go = useCallback((k: number) => {
    const next = (k + n) % n;
    setI(next);
    const el = track.current;
    if (el) el.scrollTo({ left: el.clientWidth * next, behavior: "smooth" });
  }, [n]);

  useEffect(() => {
    if (n < 2 || !intervalMs || paused) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => { if (!document.hidden) go(i + 1); }, intervalMs);
    return () => clearInterval(t);
  }, [i, n, intervalMs, paused, go]);

  // keep the dot in sync when the buyer swipes
  function onScroll() {
    const el = track.current;
    if (!el) return;
    const k = Math.round(el.scrollLeft / el.clientWidth);
    if (k !== i && k >= 0 && k < n) setI(k);
  }

  return (
    <section className={`sf-slider${center ? " center" : ""}`} aria-roledescription="carousel" aria-label="Featured"
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocusCapture={() => setPaused(true)} onBlurCapture={() => setPaused(false)}>
      <div className="sf-slides" ref={track} onScroll={onScroll}>
        {slides.map((s, k) => (
          <div className={`sf-slide${s.image ? " has-img" : ""}`} key={k} role="group" aria-roledescription="slide" aria-label={`${k + 1} of ${n}`} aria-hidden={k !== i}>
            {s.image && (
              // phones get the tall photo when the merchant added one; the first slide loads first (LCP), the rest lazily
              <picture className="sf-slide-img">
                {s.imageMobile && <source media="(max-width: 760px)" srcSet={s.imageMobile} />}
                <img src={s.image} alt={s.alt || ""} loading={k === 0 ? "eager" : "lazy"} fetchPriority={k === 0 ? "high" : "low"} decoding="async" />
              </picture>
            )}
            <div className="sf-wrap">
              <div className="copy">
                {k === 0 ? <h1>{s.heading}</h1> : <h2 className="h1">{s.heading}</h2>}
                {s.text && <p>{s.text}</p>}
                {s.buttons.length > 0 && (
                  <div className="btns">{s.buttons.map((b, bi) => <a key={bi} className={`sf-btn${bi ? " light" : ""}`} href={b.href} tabIndex={k === i ? 0 : -1}>{b.label}</a>)}</div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
      {n > 1 && (
        <>
          <button className="sf-sl-arrow prev" onClick={() => go(i - 1)} aria-label="Previous slide"><ChevronLeft size={22} /></button>
          <button className="sf-sl-arrow next" onClick={() => go(i + 1)} aria-label="Next slide"><ChevronRight size={22} /></button>
          <div className="sf-dots">{slides.map((_, k) => <button key={k} className={k === i ? "on" : ""} onClick={() => go(k)} aria-label={`Go to slide ${k + 1}`} aria-current={k === i} />)}</div>
        </>
      )}
    </section>
  );
}
