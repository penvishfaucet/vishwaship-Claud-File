"use client";
import { useEffect } from "react";

/**
 * Swipe hints for wide tables on every page (portal, admin, franchise, public). It never moves or wraps nodes React
 * owns: it only toggles classes on the existing scroll boxes (`.tbl-wrap`, `.card.p0` holding a table, `.ov-tablewrap`,
 * `.sx`) and makes a box that can scroll keyboard-focusable with a label. The fades and the note are in styles/mobile.css.
 */
const BOXES = ".tbl-wrap, .card.p0, .ov-tablewrap, .table-wrap, .sx";

function label(box: HTMLElement) {
  const cap = box.querySelector("caption")?.textContent?.trim();
  if (cap) return cap;
  let el: Element | null = box;
  for (let i = 0; i < 6 && el; i++) {
    let p: Element | null = el.previousElementSibling;
    while (p) { const h = p.matches("h1,h2,h3,h4") ? p : p.querySelector("h1,h2,h3,h4"); if (h?.textContent?.trim()) return `${h.textContent.trim()} — table`; p = p.previousElementSibling; }
    el = el.parentElement;
  }
  return "Table";
}

export function TableScroll() {
  useEffect(() => {
    const seen = new WeakSet<HTMLElement>();
    const update = (box: HTMLElement) => {
      const more = box.scrollWidth - box.clientWidth > 2;
      box.classList.toggle("sx-on", more);
      if (!more) { box.classList.remove("sx-l", "sx-r"); return; }
      box.classList.toggle("sx-l", box.scrollLeft > 2);
      box.classList.toggle("sx-r", box.scrollLeft + box.clientWidth < box.scrollWidth - 2);
      if (!box.hasAttribute("tabindex")) box.setAttribute("tabindex", "0");
      if (!box.hasAttribute("role")) box.setAttribute("role", "region");
      if (!box.hasAttribute("aria-label")) box.setAttribute("aria-label", `${label(box)} (scrolls sideways)`);
    };
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver((es) => es.forEach((e) => update(e.target as HTMLElement))) : null;
    const scan = () => {
      document.querySelectorAll<HTMLElement>(BOXES).forEach((box) => {
        if (!box.querySelector(":scope > table, :scope > form > table")) return;
        if (!seen.has(box)) {
          seen.add(box);
          box.addEventListener("scroll", () => update(box), { passive: true });
          ro?.observe(box);
          const t = box.querySelector("table"); if (t) ro?.observe(t);
        }
        update(box);
      });
    };
    let raf = 0;
    const later = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(scan); };
    scan();
    const mo = new MutationObserver(later);
    mo.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", later);
    return () => { mo.disconnect(); ro?.disconnect(); window.removeEventListener("resize", later); cancelAnimationFrame(raf); };
  }, []);
  return null;
}
