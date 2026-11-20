"use client";
/**
 * Buyer cart kept in the browser (per store). Prices here are for display only:
 * checkout (Phase 2) re-reads every price and stock level on the server.
 */
export type CartLine = { id: string; slug: string; title: string; image: string | null; pricePaise: number; qty: number };

const key = (store: string) => `sf-cart:${store}`;
export const MAX_QTY = 10;

export function readCart(store: string): CartLine[] {
  try {
    const v = JSON.parse(localStorage.getItem(key(store)) ?? "[]");
    return Array.isArray(v) ? v.filter((l) => l && typeof l.id === "string" && Number.isInteger(l.qty) && l.qty > 0) : [];
  } catch { return []; }
}

export function writeCart(store: string, lines: CartLine[]) {
  try { localStorage.setItem(key(store), JSON.stringify(lines)); } catch { /* storage blocked: cart lives for this page only */ }
  window.dispatchEvent(new CustomEvent("sf-cart", { detail: store }));
}

export function addToCart(store: string, line: Omit<CartLine, "qty">, qty: number) {
  const lines = readCart(store);
  const hit = lines.find((l) => l.id === line.id);
  if (hit) hit.qty = Math.min(MAX_QTY, hit.qty + qty);
  else lines.push({ ...line, qty: Math.min(MAX_QTY, qty) });
  writeCart(store, lines);
}

export const cartCount = (lines: CartLine[]) => lines.reduce((n, l) => n + l.qty, 0);
