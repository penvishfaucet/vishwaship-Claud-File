"use client";
import { useEffect } from "react";

/**
 * Scroll-in transitions for the public pages. Tags section content as it appears in #main and lets
 * IntersectionObserver add `.in` when it scrolls into view: headings and text rise up, cards slide in
 * from alternating sides with a short stagger. Content is only hidden after this script has run (so the
 * page is never blank without JS), and nothing is animated when the visitor prefers reduced motion.
 */
const TARGETS = [
  ".w-sec .w-eyebrow", ".w-sec .w-h2", ".w-sec .w-lead", ".w-sec .w-prose p",
  ".w-card:not(.w-form)", ".w-step", ".w-feat", ".w-svc", ".cc-ch", ".ab-svc", ".w-cta", ".w-quote",
  ".pc", ".v4-num", ".v4-track", ".w-person", ".w-office .w-map",
].join(",");

export function Reveal() {
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const main = document.getElementById("main");
    if (!main) return;
    document.documentElement.classList.add("rv-on");

    const io = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });

    const tag = (root: ParentNode) => {
      const list = Array.from(root.querySelectorAll<HTMLElement>(TARGETS)).filter((el) => !el.classList.contains("rv") && !el.closest(".h5, .rc-form, .w-drawer-wrap"));
      for (const el of list) {
        // siblings of the same kind slide in from alternating sides, one after another
        const sibs = el.parentElement ? Array.from(el.parentElement.children).filter((c) => c.className === el.className) : [el];
        const i = Math.max(0, sibs.indexOf(el));
        const card = /w-card|w-step|w-feat|w-svc|cc-ch|ab-svc|w-person|v4-num/.test(el.className);
        el.classList.add("rv", card ? (sibs.length > 1 ? (i % 2 ? "rv-r" : "rv-l") : "rv-up") : "rv-up");
        el.style.setProperty("--rv-d", `${Math.min(i, 5) * 90}ms`);
        io.observe(el);
      }
    };
    tag(main);
    // client-side navigation and late content (e.g. rate results) get the same treatment
    const mo = new MutationObserver((muts) => { for (const m of muts) m.addedNodes.forEach((n) => { if (n instanceof HTMLElement) tag(n.parentElement ?? n); }); });
    mo.observe(main, { childList: true, subtree: true });
    return () => { io.disconnect(); mo.disconnect(); };
  }, []);
  return null;
}
