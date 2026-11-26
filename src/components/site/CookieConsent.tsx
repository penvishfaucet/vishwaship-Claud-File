"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

const KEY = "vs_cookie_consent"; // "granted" | "denied"
declare global { interface Window { dataLayer?: unknown[]; gtag?: (...a: unknown[]) => void } }

/** Meta Pixel (Facebook / Instagram ads). Only after the visitor accepted cookies. */
export function loadMetaPixel(id: string) {
  if (!/^\d{10,20}$/.test(id)) return;
  type Fbq = (...a: unknown[]) => void;
  const w = window as unknown as { fbq?: Fbq };
  if (w.fbq) return;
  // Meta's official base-code stub: calls wait in fbq.queue until fbevents.js loads and replays them
  const f = function (...a: unknown[]) { const self = f as unknown as { callMethod?: (...x: unknown[]) => void; queue: unknown[] }; if (self.callMethod) self.callMethod(...a); else self.queue.push(a); } as Fbq;
  Object.assign(f, { push: f, loaded: true, version: "2.0", queue: [] });
  w.fbq = f;
  const s = document.createElement("script");
  s.async = true; s.src = "https://connect.facebook.net/en_US/fbevents.js";
  document.head.appendChild(s);
  f("init", id);
  f("track", "PageView");
}

function loadAnalytics(id: string) {
  if (window.gtag || !/^G-[A-Z0-9]{6,14}$/.test(id)) return;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function gtag() { window.dataLayer!.push(arguments); }; // eslint-disable-line prefer-rest-params
  window.gtag("js", new Date());
  window.gtag("config", id);
  const s = document.createElement("script");
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(s);
}
const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
export const cookieChoice = () => read();
const save = (v: string) => { try { localStorage.setItem(KEY, v); } catch { /* private mode: asked again next visit */ } };

/**
 * Cookie banner for the public site. Only necessary cookies (login) are used until the visitor accepts analytics;
 * Google Analytics (Admin → API Keys & Services) loads only after "Accept". Without analytics switched on there is
 * nothing to accept, so no banner — the footer's "Cookie settings" then just explains that.
 */
export function CookieConsent({ gaId, pixelId = null }: { gaId: string | null; pixelId?: string | null }) {
  const any = !!(gaId || pixelId);
  const start = () => { if (gaId) loadAnalytics(gaId); if (pixelId) loadMetaPixel(pixelId); };
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const v = read();
    if (any && v === "granted") start();
    else if (any && !v) setOpen(true);
    const again = () => setOpen(true);
    window.addEventListener("vs-cookie-settings", again);
    return () => window.removeEventListener("vs-cookie-settings", again);
  }, [gaId, pixelId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!open) return null;
  const choose = (v: "granted" | "denied") => {
    save(v); setOpen(false);
    if (v === "granted") start();
    if (v === "denied" && (window.gtag || (window as unknown as { fbq?: unknown }).fbq)) window.location.reload(); // stop analytics already loaded on this page
  };
  return (
    <div role="dialog" aria-live="polite" aria-label="Cookie settings" style={{ position: "fixed", left: 12, right: 12, bottom: 84, zIndex: 60, maxWidth: 560, margin: "0 auto", background: "#fff", color: "#051C46", border: "1px solid #d5dae5", borderRadius: 14, boxShadow: "0 10px 30px rgba(5,28,70,.18)", padding: "14px 16px", fontSize: 14, lineHeight: 1.5 }}>
      {any ? (
        <>
          <p style={{ margin: "0 0 10px" }}>We use necessary cookies to keep you signed in. With your permission we also use {gaId && pixelId ? "analytics and advertising cookies (Google Analytics, Meta Pixel)" : pixelId ? "advertising cookies (Meta Pixel)" : "analytics cookies (Google Analytics)"} to see which pages help people{pixelId ? " and which of our Facebook / Instagram ads work" : ""}. <Link href="/privacy/" style={{ color: "#051C46", textDecoration: "underline" }}>Privacy policy</Link></p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={() => choose("granted")} style={{ padding: "9px 16px", borderRadius: 10, border: 0, background: "#051C46", color: "#fff", fontWeight: 700, cursor: "pointer" }}>Accept</button>
            <button type="button" onClick={() => choose("denied")} style={{ padding: "9px 16px", borderRadius: 10, border: "1.5px solid #051C46", background: "#fff", color: "#051C46", fontWeight: 700, cursor: "pointer" }}>Only necessary</button>
          </div>
        </>
      ) : (
        <>
          <p style={{ margin: "0 0 10px" }}>This site uses only necessary cookies (to keep you signed in). No analytics or advertising cookies are set. <Link href="/privacy/" style={{ color: "#051C46", textDecoration: "underline" }}>Privacy policy</Link></p>
          <button type="button" onClick={() => setOpen(false)} style={{ padding: "9px 16px", borderRadius: 10, border: 0, background: "#051C46", color: "#fff", fontWeight: 700, cursor: "pointer" }}>OK</button>
        </>
      )}
    </div>
  );
}
