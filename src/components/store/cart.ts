"use client";
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
