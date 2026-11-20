"use client";
import { Menu, Minus, Plus, ShoppingBag, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { type CartLine, MAX_QTY, addToCart, captureAttribution, cartCount, readCart, writeCart } from "./cart";
import type { SfVariant } from "./types";
export { useCartState };

import { rupees } from "@/lib/store-themes";

/** null until the browser cart has been read (avoids flashing "empty" on load). */
function useCartState(store: string) {
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
const useCart = (store: string) => useCartState(store) ?? [];

export function HeaderNav({ store, base, links }: { store: string; base: string; links: Array<{ href: string; label: string }> }) {
  const [open, setOpen] = useState(false);
  const n = cartCount(useCart(store));
  return (
    <>
      <nav className={`sf-nav${open ? " open" : ""}`} aria-label="Store">
        {links.map((l) => <a key={l.href} href={l.href} onClick={() => setOpen(false)}>{l.label}</a>)}
      </nav>
      <button className="sf-menu-btn" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <X size={22} /> : <Menu size={22} />}</button>
      <a className="sf-cart" href={`${base}/cart/`} aria-label={`Cart, ${n} item${n === 1 ? "" : "s"}`}>
        <ShoppingBag size={20} aria-hidden />{n > 0 && <span className="n">{n}</span>}
      </a>
    </>
  );
}

export function ProductGallery({ images, title }: { images: string[]; title: string }) {
  const [i, setI] = useState(0);
  return (
    <div>
      <div className="main">{images[i] ? <img src={images[i]} alt={title} /> : null}</div>
      {images.length > 1 && (
        <div className="sf-thumbs">
          {images.map((src, k) => <button key={src} className={k === i ? "on" : ""} onClick={() => setI(k)} aria-label={`Image ${k + 1}`}><img src={src} alt="" /></button>)}
        </div>
      )}
    </div>
  );
}

/** Records UTM / click ids from the landing URL once per visit (for ad attribution at checkout). */
export function AttributionCapture({ store }: { store: string }) {
  useEffect(() => { captureAttribution(store); }, [store]);
  return null;
}

export function AddToCart({ store, base, product }: { store: string; base: string; product: { id: string; slug: string; title: string; image: string | null; pricePaise: number; comparePaise: number | null; inStock: boolean; options: string[]; variants: SfVariant[] } }) {
  const [qty, setQty] = useState(1);
  const [toast, setToast] = useState("");
  const hasVariants = product.options.length > 0;
  const firstAvail = product.variants.find((v) => v.inStock) ?? product.variants[0];
  const [sel, setSel] = useState<string[]>(firstAvail?.values ?? []);
  const variant = hasVariants ? product.variants.find((v) => v.values.join("|") === sel.join("|")) ?? null : null;
  if (!product.inStock) return <p className="sf-oos" style={{ fontSize: 15, margin: "20px 0" }}>Currently out of stock</p>;
  const price = variant?.pricePaise ?? product.pricePaise;
  const canBuy = !hasVariants || !!variant?.inStock;
  function add(go: boolean) {
    if (!canBuy) return;
    addToCart(store, { productId: product.id, variantId: variant?.id ?? null, variantTitle: variant?.title ?? null, slug: product.slug, title: product.title, image: product.image, pricePaise: price }, qty);
    if (go) { window.location.href = `${base}/cart/`; return; }
    setToast("Added to cart"); setTimeout(() => setToast(""), 1800);
  }
  return (
    <>
      {hasVariants && (
        <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
          {variant && <div className="sf-price" style={{ marginTop: -8 }}><b style={{ fontSize: 24 }}>{rupees(variant.pricePaise)}</b>{variant.comparePaise && variant.comparePaise > variant.pricePaise && <s>{rupees(variant.comparePaise)}</s>}<span className="sf-note" style={{ flexBasis: "100%" }}>Inclusive of all taxes</span></div>}
          {product.options.map((opt, oi) => {
            const values = [...new Set(product.variants.map((v) => v.values[oi]).filter(Boolean))];
            return (
              <fieldset key={opt} style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="sf-note" style={{ marginBottom: 6 }}>{opt}: <b style={{ color: "var(--sf-text)" }}>{sel[oi]}</b></legend>
                <div className="sf-filters" style={{ marginBottom: 0 }}>
                  {values.map((val) => {
                    const next = sel.map((s, i) => (i === oi ? val : s));
                    const v = product.variants.find((x) => x.values.join("|") === next.join("|"));
                    return <button key={val} type="button" className={`sf-chip${sel[oi] === val ? " on" : ""}`} aria-pressed={sel[oi] === val} onClick={() => setSel(next)} style={{ cursor: "pointer", background: sel[oi] === val ? undefined : "transparent", opacity: v && !v.inStock ? 0.45 : 1, textDecoration: v && !v.inStock ? "line-through" : "none", font: "inherit" }}>{val}</button>;
                  })}
                </div>
              </fieldset>
            );
          })}
          {(!variant || !variant.inStock) && <p className="sf-oos" style={{ margin: 0 }}>{variant ? "This option is out of stock" : "This combination is not available"}</p>}
        </div>
      )}
      <div className="sf-buy">
        <div className="sf-qty" role="group" aria-label="Quantity">
          <button onClick={() => setQty(Math.max(1, qty - 1))} aria-label="Decrease quantity"><Minus size={16} /></button>
          <span aria-live="polite">{qty}</span>
          <button onClick={() => setQty(Math.min(MAX_QTY, qty + 1))} aria-label="Increase quantity"><Plus size={16} /></button>
        </div>
        <button className="sf-btn" onClick={() => add(false)} disabled={!canBuy}>Add to cart</button>
        <button className="sf-btn ghost" onClick={() => add(true)} disabled={!canBuy}>Buy now</button>
      </div>
      {toast && <div className="sf-toast" role="status">{toast}</div>}
    </>
  );
}

export function CartView({ store, base, checkout }: { store: string; base: string; checkout: { codEnabled: boolean; shippingFeePaise: number; freeShippingAbovePaise: number; ready: boolean; demo: boolean } }) {
  const state = useCartState(store);
  if (state === null) return <p className="sf-note" role="status">Loading your cart…</p>;
  const lines = state;
  const set = (id: string, qty: number) => writeCart(store, readCart(store).flatMap((l) => (l.id !== id ? [l] : qty > 0 ? [{ ...l, qty: Math.min(MAX_QTY, qty) }] : [])));
  if (!lines.length) return <div className="sf-empty"><p>Your cart is empty.</p><a className="sf-btn" href={`${base}/shop/`}>Continue shopping</a></div>;
  const sub = lines.reduce((s, l) => s + l.pricePaise * l.qty, 0);
  const ship = checkout.freeShippingAbovePaise > 0 && sub >= checkout.freeShippingAbovePaise ? 0 : checkout.shippingFeePaise;
  return (
    <div className="sf-cartgrid">
      <div className="sf-cartlist">
        {lines.map((l) => (
          <div className="sf-line" key={l.id}>
            {l.image ? <img src={l.image} alt="" /> : <span />}
            <div>
              <a href={`${base}/products/${l.slug}/`} style={{ fontWeight: 600 }}>{l.title}</a>{l.variantTitle && <div className="sf-note">{l.variantTitle}</div>}
              <div className="sf-note">{rupees(l.pricePaise)} each</div>
              <div className="sf-qty" style={{ marginTop: 8 }} role="group" aria-label={`Quantity for ${l.title}`}>
                <button onClick={() => set(l.id, l.qty - 1)} aria-label="Decrease quantity"><Minus size={14} /></button>
                <span>{l.qty}</span>
                <button onClick={() => set(l.id, l.qty + 1)} aria-label="Increase quantity"><Plus size={14} /></button>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <b>{rupees(l.pricePaise * l.qty)}</b>
              <div><button className="sf-link" onClick={() => set(l.id, 0)} aria-label={`Remove ${l.title}`}><Trash2 size={14} style={{ verticalAlign: "-2px" }} /> Remove</button></div>
            </div>
          </div>
        ))}
      </div>
      <aside className="sf-summary" aria-label="Order summary">
        <div className="row"><span>Subtotal</span><b>{rupees(sub)}</b></div>
        <div className="row"><span>Shipping</span><span>{ship ? rupees(ship) : "Free"}</span></div>
        <div className="row" style={{ borderTop: "1px solid var(--sf-line)", paddingTop: 10 }}><span>Total</span><b>{rupees(sub + ship)}</b></div>
        {checkout.codEnabled && <p className="sf-note" style={{ margin: 0 }}>Cash on Delivery available</p>}
        {checkout.ready ? <a className="sf-btn" href={`${base}/checkout/`}>Checkout</a> : <button className="sf-btn" disabled>Checkout</button>}
        {!checkout.ready && <p className="sf-note" style={{ margin: 0 }}>{checkout.demo ? "This is a demo store — orders can't be placed here." : "Checkout works once the store is published."}</p>}
        <p className="sf-note" style={{ margin: 0 }}>Final price, shipping and discounts are confirmed at checkout.</p>
      </aside>
    </div>
  );
}
