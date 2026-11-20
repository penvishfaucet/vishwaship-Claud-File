"use client";
import { useEffect, useRef, useState } from "react";

const reduced = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** One word at a time slides up into place (e.g. "Shipping for small businesses / D2C brands / …"). */
export function RotatingWords({ words, every = 2400 }: { words: string[]; every?: number }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (words.length < 2 || reduced()) return;
    const t = window.setInterval(() => setI((n) => (n + 1) % words.length), every);
    return () => window.clearInterval(t);
  }, [words.length, every]);
  return (
    <span className="v6-rot" aria-live="off">
      {/* the widest word keeps the space so the line never jumps */}
      <span className="sizer" aria-hidden="true">{words.reduce((a, b) => (b.length > a.length ? b : a), "")}</span>
      <span key={i} className="word">{words[i]}</span>
      <span className="sr-only">{words.join(", ")}</span>
    </span>
  );
}

/** Counts the first number inside `text` up from 0 when it scrolls into view ("From ₹28" → ₹0…₹28). */
export function CountUp({ text, ms = 1200 }: { text: string; ms?: number }) {
  const m = /(\d+(?:\.\d+)?)/.exec(text);
  const target = m ? Number(m[1]) : 0;
  const ref = useRef<HTMLSpanElement>(null);
  const [n, setN] = useState<number | null>(null);
  useEffect(() => {
    if (!m || reduced() || typeof IntersectionObserver === "undefined") return;
    const el = ref.current;
    if (!el) return;
    setN(0);
    let raf = 0;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      const t0 = performance.now();
      const step = (t: number) => {
        const p = Math.min(1, (t - t0) / ms);
        setN(Math.round(target * (1 - Math.pow(1 - p, 3))));
        if (p < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }, { threshold: 0.4 });
    io.observe(el);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [target, ms]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = m && n !== null ? text.replace(m[1], String(n)) : text;
  return <span ref={ref}>{shown}</span>;
}
