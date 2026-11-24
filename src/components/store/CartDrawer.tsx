"use client";
import { CheckCircle2, Minus, Plus, ShoppingBag, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { rupees } from "@/lib/store-themes";
import { type CartLine, MAX_QTY, addToCart, cartCount, readCart, writeCart } from "./cart";
import { useCartState } from "./cart";
import { track } from "./Tracking";
import type { SfMini } from "./types";

export type CheckoutInfo = { codEnabled: boolean; shippingFeePaise: number; freeShippingAbovePaise: number; ready: boolean; demo: boolean };
/** recs: productId → add-on product ids (merchant-chosen first, then bought together). pool: card data for those ids + best sellers. */
export type RecData = { recs: Record<string, string[]>; pool: SfMini[]; best: string[] };

const setQty = (store: string, id: string, qty: number) =>
  writeCart(store, readCart(store).flatMap((l) => (l.id !== id ? [l] : qty > 0 ? [{ ...l, qty: Math.min(MAX_QTY, qty) }] : [])));

/** Up to `n` add-ons for what is in the cart: in stock, not already in the cart, in the order the merchant set them. */
export function pickAddons(lines: CartLine[], data: RecData, n = 3): SfMini[] {
  const inCart = new Set(lines.map((l) => l.productId));
  const byId = new Map(data.pool.map((p) => [p.id, p]));
  const out: SfMini[] = [];
  for (const l of [...lines].reverse()) { // the item added last first
    for (const id of data.recs[l.productId] ?? []) {
      const p = byId.get(id);
      if (p && p.inStock && !inCart.has(id) && !out.some((x) => x.id === id)) out.push(p);
      if (out.length >= n) return out;
    }
  }
  return out;
}

export function bestMinis(data: RecData, n: number) {
  const byId = new Map(data.pool.map((p) => [p.id, p]));
  return data.best.map((id) => byId.get(id)).filter((p): p is SfMini => !!p && p.inStock).slice(0, n);
}

/** One add-on / suggestion row: photo, name, price, "+ Add" (or "Choose" when it has sizes/colours). */
export function MiniRow({ store, base, p, list }: { store: string; base: string; p: SfMini; list: string }) {
  const [added, setAdded] = useState(false);
  const item = { id: p.id, name: p.title, price: p.pricePaise / 100, qty: 1 };
  return (
    <div className="sf-mini">
      <a href={`${base}/products/${p.slug}/`} onClick={() => track({ name: "recommendation_click", list, item })}>{p.image ? <img src={p.image} alt="" loading="lazy" width={64} height={64} /> : <span className="ph" />}</a>
      <div className="t">
        <a href={`${base}/products/${p.slug}/`} onClick={() => track({ name: "recommendation_click", list, item })}>{p.title}</a>
        <div><b>{rupees(p.pricePaise)}</b>{p.comparePaise && p.comparePaise > p.pricePaise ? <s>{rupees(p.comparePaise)}</s> : null}</div>
      </div>
      {p.hasOptions
        ? <a className="sf-btn ghost sm" href={`${base}/products/${p.slug}/`} onClick={() => track({ name: "recommendation_click", list, item })}>Choose</a>
        : <button type="button" className="sf-btn sm" disabled={added} aria-label={`Add ${p.title} to cart`} onClick={() => {
          addToCart(store, { productId: p.id, variantId: null, variantTitle: null, slug: p.slug, title: p.title, image: p.image, pricePaise: p.pricePaise }, 1);
          track({ name: "recommendation_add", list, item });
          setAdded(true); setTimeout(() => setAdded(false), 1500);
        }}>{added ? "Added" : "+ Add"}</button>}
    </div>
  );
}

function shippingOf(sub: number, c: CheckoutInfo) {
  return c.freeShippingAbovePaise > 0 && sub >= c.freeShippingAbovePaise ? 0 : c.shippingFeePaise;
}

/**
 * Slide-in cart. Opens after "Add to cart" (event sf-cart-open) and from the header cart icon.
 * Desktop: right-side drawer; phones: full-height sheet. Esc / backdrop / × close it; focus returns to where it was.
 */
export function CartDrawer({ store, base, checkout, data }: { store: string; base: string; checkout: CheckoutInfo; data: RecData }) {
  const lines = useCartState(store) ?? [];
  const [open, setOpen] = useState(false);
  const [justAdded, setJustAdded] = useState(false);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const back = useRef<Element | null>(null);
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d !== store && !(d && typeof d === "object" && d.store === store)) return;
      back.current = document.activeElement;
      setJustAdded(!(d && typeof d === "object" && d.browse));
      setOpen(true);
    };
    window.addEventListener("sf-cart-open", on);
    return () => window.removeEventListener("sf-cart-open", on);
  }, [store]);
  useEffect(() => {
    if (!open) return;
    closeBtn.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", key);
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", key); document.body.style.overflow = prev; (back.current as HTMLElement | null)?.focus?.(); };
  }, [open]);

  const sub = lines.reduce((s, l) => s + l.pricePaise * l.qty, 0);
  const ship = shippingOf(sub, checkout);
  const toFree = checkout.freeShippingAbovePaise > 0 && sub < checkout.freeShippingAbovePaise ? checkout.freeShippingAbovePaise - sub : 0;
  const addons = pickAddons(lines, data, 3);
  const best = lines.length ? [] : bestMinis(data, 4);
  const n = cartCount(lines);

  return (
    <div className={`sf-drawer${open ? " open" : ""}`} aria-hidden={!open}>
      <div className="sf-drawer-bg" onClick={() => setOpen(false)} />
      <aside className="sf-drawer-panel" role="dialog" aria-modal="true" aria-label="Your cart" inert={!open}>
        <header className="sf-drawer-h">
          <b><ShoppingBag size={18} aria-hidden /> Your cart{n ? ` (${n})` : ""}</b>
          <button type="button" ref={closeBtn} className="sf-ic" onClick={() => setOpen(false)} aria-label="Close cart"><X size={20} /></button>
        </header>
        <div className="sf-drawer-body">
          {justAdded && lines.length > 0 && <p className="sf-drawer-ok" role="status"><CheckCircle2 size={16} aria-hidden /> Added to cart</p>}
          {lines.length === 0 ? (
            <div className="sf-empty" style={{ padding: "18px 0" }}>
              <p>Your cart is empty.</p>
              <a className="sf-btn" href={`${base}/shop/`}>Continue shopping</a>
              {best.length > 0 && <div className="sf-recs"><h3>Best sellers</h3>{best.map((p) => <MiniRow key={p.id} store={store} base={base} p={p} list="drawer_best_sellers" />)}</div>}
            </div>
          ) : (
            <>
              {lines.map((l) => (
                <div className="sf-line sm" key={l.id}>
                  {l.image ? <img src={l.image} alt="" width={64} height={64} /> : <span />}
                  <div>
                    <a href={`${base}/products/${l.slug}/`} style={{ fontWeight: 600 }}>{l.title}</a>{l.variantTitle && <div className="sf-note">{l.variantTitle}</div>}
                    <div className="sf-note">{rupees(l.pricePaise)} each</div>
                    <div className="sf-qty" style={{ marginTop: 6 }} role="group" aria-label={`Quantity for ${l.title}`}>
                      <button type="button" onClick={() => setQty(store, l.id, l.qty - 1)} aria-label="Decrease quantity"><Minus size={14} /></button>
                      <span aria-live="polite">{l.qty}</span>
                      <button type="button" onClick={() => setQty(store, l.id, l.qty + 1)} aria-label="Increase quantity" disabled={l.qty >= MAX_QTY}><Plus size={14} /></button>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <b>{rupees(l.pricePaise * l.qty)}</b>
                    <div><button type="button" className="sf-link" onClick={() => setQty(store, l.id, 0)} aria-label={`Remove ${l.title}`}><Trash2 size={14} style={{ verticalAlign: "-2px" }} /> Remove</button></div>
                  </div>
                </div>
              ))}
              {addons.length > 0 && <div className="sf-recs"><h3>Complete your purchase</h3>{addons.map((p) => <MiniRow key={p.id} store={store} base={base} p={p} list="cart_drawer_addons" />)}</div>}
            </>
          )}
        </div>
        {lines.length > 0 && (
          <footer className="sf-drawer-f">
            {toFree > 0 && <p className="sf-note" style={{ margin: 0 }}>Add {rupees(toFree)} more for free shipping</p>}
            <div className="row"><span>Subtotal</span><b>{rupees(sub)}</b></div>
            <div className="row sf-note"><span>Shipping</span><span>{ship ? rupees(ship) : "Free"}</span></div>
            <p className="sf-note" style={{ margin: 0 }}>Discounts{checkout.codEnabled ? ", COD fee (if any)" : ""} and the final total are shown at checkout after your pincode.</p>
            {checkout.ready ? <a className="sf-btn" href={`${base}/checkout/`}>Checkout · {rupees(sub + ship)}</a> : <button className="sf-btn" disabled>Checkout</button>}
            {!checkout.ready && <p className="sf-note" style={{ margin: 0 }}>{checkout.demo ? "This is a demo store — orders can't be placed here." : "Checkout works once the store is published."}</p>}
            <a className="sf-link" href={`${base}/cart/`} style={{ textAlign: "center" }}>View full cart</a>
          </footer>
        )}
      </aside>
    </div>
  );
}
