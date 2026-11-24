"use client";
import { useEffect, useState } from "react";
import { track } from "./Tracking";
/**
 * Buyer cart kept in the browser (per store). Prices here are for display only:
 * checkout re-reads every price and stock level on the server.
 */
export type CartLine = { id: string; productId: string; variantId: string | null; slug: string; title: string; variantTitle: string | null; image: string | null; pricePaise: number; qty: number };

const key = (store: string) => `sf-cart:${store}`;
export const MAX_QTY = 10;

export function readCart(store: string): CartLine[] {
  try {
    const v = JSON.parse(localStorage.getItem(key(store)) ?? "[]");
    if (!Array.isArray(v)) return [];
    return v.filter((l) => l && typeof l.id === "string" && Number.isInteger(l.qty) && l.qty > 0)
      .map((l) => ({ variantId: null, variantTitle: null, productId: l.id, ...l }));
  } catch { return []; }
}

export function writeCart(store: string, lines: CartLine[]) {
  try { localStorage.setItem(key(store), JSON.stringify(lines)); } catch { /* storage blocked: cart lives for this page only */ }
  window.dispatchEvent(new CustomEvent("sf-cart", { detail: store }));
}

export function addToCart(store: string, line: Omit<CartLine, "qty" | "id">, qty: number) {
  const id = line.variantId ? `${line.productId}:${line.variantId}` : line.productId;
  const lines = readCart(store);
  const hit = lines.find((l) => l.id === id);
  if (hit) hit.qty = Math.min(MAX_QTY, hit.qty + qty);
  else lines.push({ ...line, id, qty: Math.min(MAX_QTY, qty) });
  writeCart(store, lines);
  track({ name: "add_to_cart", item: { id: line.variantId ?? line.productId, name: line.title, price: line.pricePaise / 100, qty } });
}

export const clearCart = (store: string) => writeCart(store, []);

/** null until the browser cart has been read (avoids flashing "empty" on load). Follows changes from other tabs too. */
export function useCartState(store: string) {
  const [lines, setLines] = useState<CartLine[] | null>(null);
  useEffect(() => {
    const sync = () => setLines(readCart(store));
    sync();
    const on = (e: Event) => { if ((e as CustomEvent).detail === store) sync(); };
    window.addEventListener("sf-cart", on);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener("sf-cart", on); window.removeEventListener("storage", sync); };
  }, [store]);
  return lines;
}

/** Opens the cart drawer (mounted once per storefront page). */
export const openCart = (store: string) => window.dispatchEvent(new CustomEvent("sf-cart-open", { detail: store }));

/**
 * Buy now: one product checked out on its own. Kept apart from the cart (this tab only), so the items already
 * in the cart stay there. The order page clears whichever of the two was checked out.
 */
const buyKey = (store: string) => `sf-buy:${store}`;
export const BUY_ACTIVE = (store: string) => `sf-buy-active:${store}`;
export function setBuyNow(store: string, line: Omit<CartLine, "qty" | "id">, qty: number) {
  const id = line.variantId ? `${line.productId}:${line.variantId}` : line.productId;
  try { sessionStorage.setItem(buyKey(store), JSON.stringify([{ ...line, id, qty: Math.min(MAX_QTY, qty) }])); } catch { /* storage blocked */ }
  track({ name: "add_to_cart", item: { id: line.variantId ?? line.productId, name: line.title, price: line.pricePaise / 100, qty } });
}
export function readBuyNow(store: string): CartLine[] {
  try {
    const v = JSON.parse(sessionStorage.getItem(buyKey(store)) ?? "[]");
    return Array.isArray(v) ? v.filter((l) => l && typeof l.id === "string" && Number.isInteger(l.qty) && l.qty > 0) : [];
  } catch { return []; }
}
export function clearBuyNow(store: string) {
  try { sessionStorage.removeItem(buyKey(store)); sessionStorage.removeItem(BUY_ACTIVE(store)); } catch { /* ignore */ }
}
export const cartCount = (lines: CartLine[]) => lines.reduce((n, l) => n + l.qty, 0);

/** UTM / click ids from the first landing page of this visit (used for ad attribution). */
const ATTR_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "gclid"];
export function captureAttribution(store: string) {
  try {
    const sp = new URLSearchParams(location.search);
    const found = Object.fromEntries(ATTR_KEYS.filter((k) => sp.get(k)).map((k) => [k, sp.get(k)!.slice(0, 200)]));
    if (Object.keys(found).length) localStorage.setItem(`sf-attr:${store}`, JSON.stringify({ ...found, landing: location.pathname.slice(0, 200), at: new Date().toISOString() }));
  } catch { /* ignore */ }
}
export function readAttribution(store: string): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(`sf-attr:${store}`) ?? "{}"); } catch { return {}; }
}
