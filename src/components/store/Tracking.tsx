"use client";
import { useEffect, useState } from "react";

/**
 * Storefront consent + marketing tags. Nothing third-party loads until the buyer chooses:
 *  - "analytics" → GA4 (gtag, Consent Mode v2), unique-visitor counting
 *  - "marketing" → Meta Pixel and the Google Ads conversion tag
 * Page views are always counted (no identifier). Events from other components arrive as "sf-track" window events.
 */
export type Tags = { metaPixelId: string | null; ga4Id: string | null; gadsId: string | null; gadsLabel: string | null };
type Consent = { analytics: boolean; marketing: boolean };
type Item = { id: string; name: string; price: number; qty: number };
export type TrackEvent =
  | { name: "view_item"; item: Item }
  | { name: "add_to_cart"; item: Item }
  | { name: "begin_checkout"; value: number; items: Item[] }
  /** Recommendation shown in "Complete your purchase" / Best sellers: clicked (opened) or added straight to the cart. */
  | { name: "recommendation_click" | "recommendation_add"; list: string; item: Item }
  | { name: "purchase"; eventId: string; orderNumber: string; value: number; items: Item[] };

declare global { interface Window { fbq?: ((...a: unknown[]) => void) & { q?: unknown[]; loaded?: boolean }; dataLayer?: unknown[]; gtag?: (...a: unknown[]) => void } }

const cKey = (s: string) => `sf-consent:${s}`;
export function readConsent(store: string): Consent | null {
  try { const v = JSON.parse(localStorage.getItem(cKey(store)) ?? "null"); return v && typeof v.analytics === "boolean" ? v : null; } catch { return null; }
}
export const consentString = (c: Consent | null) => (c ? [c.analytics && "analytics", c.marketing && "marketing"].filter(Boolean).join(",") : "");

export function track(e: TrackEvent) {
  window.dispatchEvent(new CustomEvent("sf-track", { detail: e }));
}

function cookie(name: string) {
  return document.cookie.split("; ").find((c) => c.startsWith(`${name}=`))?.split("=").slice(1).join("=") ?? "";
}
/** Browser ids the server needs to match its events with the pixel (only after consent). */
export function browserIds(store: string): Record<string, string> {
  const c = readConsent(store);
  const out: Record<string, string> = { consent: consentString(c) };
  if (c?.marketing) { const fbp = cookie("_fbp"), fbc = cookie("_fbc"); if (fbp) out.fbp = fbp; if (fbc) out.fbc = fbc; }
  if (c?.analytics) { const ga = cookie("_ga").split(".").slice(-2).join("."); if (/^\d+\.\d+$/.test(ga)) out.gaClientId = ga; }
  return out;
}

function loadScript(src: string) {
  if (document.querySelector(`script[src="${src}"]`)) return;
  const s = document.createElement("script"); s.async = true; s.src = src; document.head.appendChild(s);
}

function startGtag(tags: Tags, c: Consent) {
  const ids = [c.analytics && tags.ga4Id, c.marketing && tags.gadsId].filter((x): x is string => !!x);
  if (!ids.length) return;
  window.dataLayer = window.dataLayer || [];
  if (!window.gtag) {
    // gtag must push the arguments object itself
    // eslint-disable-next-line prefer-rest-params
    window.gtag = function () { window.dataLayer!.push(arguments); };
    window.gtag("consent", "default", { ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", analytics_storage: "denied" });
    window.gtag("js", new Date());
  }
  window.gtag("consent", "update", { analytics_storage: c.analytics ? "granted" : "denied", ad_storage: c.marketing ? "granted" : "denied", ad_user_data: c.marketing ? "granted" : "denied", ad_personalization: c.marketing ? "granted" : "denied" });
  for (const id of ids) window.gtag("config", id);
  loadScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ids[0])}`);
}

function startPixel(pixelId: string) {
  if (window.fbq) return;
  const f = function (...a: unknown[]) { (f.q = f.q || []).push(a); } as NonNullable<Window["fbq"]>;
  // Meta's loader replaces fbq with the real one and replays the queue
  (f as unknown as { push: unknown }).push = f; f.loaded = true; (f as unknown as { version: string }).version = "2.0"; f.q = [];
  window.fbq = f;
  loadScript("https://connect.facebook.net/en_US/fbevents.js");
  window.fbq("init", pixelId);
  window.fbq("track", "PageView");
}

function send(e: TrackEvent, tags: Tags, c: Consent) {
  const ga = (name: string, p: Record<string, unknown>) => { if (window.gtag && (c.analytics || c.marketing)) window.gtag("event", name, { currency: "INR", ...p }); };
  const fb = (name: string, p: Record<string, unknown>, eventID?: string) => { if (window.fbq && c.marketing && tags.metaPixelId) window.fbq("track", name, { currency: "INR", ...p }, eventID ? { eventID } : undefined); };
  const gaItems = (items: Item[]) => items.map((i) => ({ item_id: i.id, item_name: i.name, price: i.price, quantity: i.qty }));
  if (e.name === "view_item") { ga("view_item", { value: e.item.price, items: gaItems([e.item]) }); fb("ViewContent", { value: e.item.price, content_ids: [e.item.id], content_type: "product" }); }
  if (e.name === "add_to_cart") { ga("add_to_cart", { value: e.item.price * e.item.qty, items: gaItems([e.item]) }); fb("AddToCart", { value: e.item.price * e.item.qty, content_ids: [e.item.id], content_type: "product" }); }
  if (e.name === "recommendation_click") ga("select_item", { item_list_name: e.list, items: gaItems([e.item]) });
  // the cart add itself is already sent as add_to_cart; this only says it came from a recommendation
  if (e.name === "recommendation_add") ga("recommendation_add", { item_list_name: e.list, items: gaItems([e.item]) });
  if (e.name === "begin_checkout") { ga("begin_checkout", { value: e.value, items: gaItems(e.items) }); fb("InitiateCheckout", { value: e.value, num_items: e.items.reduce((n, i) => n + i.qty, 0) }); }
  if (e.name === "purchase") {
    ga("purchase", { transaction_id: e.orderNumber, value: e.value, items: gaItems(e.items) });
    fb("Purchase", { value: e.value, content_ids: e.items.map((i) => i.id), content_type: "product", num_items: e.items.reduce((n, i) => n + i.qty, 0) }, e.eventId);
    if (c.marketing && tags.gadsId && tags.gadsLabel && window.gtag) window.gtag("event", "conversion", { send_to: `${tags.gadsId}/${tags.gadsLabel}`, value: e.value, currency: "INR", transaction_id: e.orderNumber });
  }
}

export function StoreTracking({ store, tags, policyHref }: { store: string; tags: Tags; policyHref: string }) {
  const [consent, setConsent] = useState<Consent | null | undefined>(undefined);
  const [custom, setCustom] = useState(false);
  const [draft, setDraft] = useState<Consent>({ analytics: true, marketing: true });

  useEffect(() => { setConsent(readConsent(store)); }, [store]);

  // page view beacon (visitor id only with analytics consent)
  useEffect(() => {
    if (consent === undefined) return;
    let vid = "";
    if (consent?.analytics) {
      try { vid = localStorage.getItem("sf-vid") || crypto.randomUUID().replace(/-/g, ""); localStorage.setItem("sf-vid", vid); } catch { vid = ""; }
    }
    const body = JSON.stringify({ vid: vid || null });
    if (!navigator.sendBeacon?.(`/api/store/${store}/visit/`, new Blob([body], { type: "application/json" }))) {
      fetch(`/api/store/${store}/visit/`, { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => {});
    }
  }, [store, consent]);

  useEffect(() => {
    if (!consent) return;
    if (consent.marketing && tags.metaPixelId) startPixel(tags.metaPixelId);
    startGtag(tags, consent);
    const on = (ev: Event) => send((ev as CustomEvent<TrackEvent>).detail, tags, consent);
    window.addEventListener("sf-track", on);
    return () => window.removeEventListener("sf-track", on);
  }, [consent, tags]);

  function save(c: Consent) {
    try { localStorage.setItem(cKey(store), JSON.stringify({ ...c, at: new Date().toISOString() })); } catch { /* ignore */ }
    setConsent(c); setCustom(false);
  }

  if (consent !== null) return null;
  return (
    <div className="sf-consent" role="dialog" aria-label="Cookie choices" aria-live="polite">
      <p style={{ margin: 0 }}>We use cookies to run this store{tags.metaPixelId || tags.ga4Id || tags.gadsId ? ", measure visits and show relevant ads" : " and count visits"}. <a href={policyHref} style={{ textDecoration: "underline" }}>Privacy policy</a></p>
      {custom && (
        <div style={{ display: "grid", gap: 6, margin: "10px 0" }}>
          <label style={{ display: "flex", gap: 8 }}><input type="checkbox" checked disabled /> Necessary (cart, checkout)</label>
          <label style={{ display: "flex", gap: 8 }}><input type="checkbox" checked={draft.analytics} onChange={(e) => setDraft({ ...draft, analytics: e.target.checked })} /> Analytics (visits, Google Analytics)</label>
          <label style={{ display: "flex", gap: 8 }}><input type="checkbox" checked={draft.marketing} onChange={(e) => setDraft({ ...draft, marketing: e.target.checked })} /> Marketing (Meta and Google ads)</label>
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        <button className="sf-btn" onClick={() => save(custom ? draft : { analytics: true, marketing: true })}>{custom ? "Save choices" : "Accept all"}</button>
        <button className="sf-btn ghost" onClick={() => save({ analytics: false, marketing: false })}>Only necessary</button>
        {!custom && <button className="sf-link" onClick={() => setCustom(true)}>Choose</button>}
      </div>
    </div>
  );
}

/** Fires one storefront event when mounted (e.g. product view, order confirmation). */
export function TrackOnMount({ event, onceKey }: { event: TrackEvent; onceKey?: string }) {
  useEffect(() => {
    if (onceKey) { try { if (localStorage.getItem(onceKey)) return; localStorage.setItem(onceKey, "1"); } catch { /* ignore */ } }
    // let the tracking component attach its listener first
    const t = setTimeout(() => track(event), 300);
    return () => clearTimeout(t);
  }, [event, onceKey]);
  return null;
}
