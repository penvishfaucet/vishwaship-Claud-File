"use client";
import { CheckCircle2, ChevronLeft, ChevronRight, Menu, Minus, Plus, Search, ShoppingBag, Star, Trash2, Truck, User, X, ZoomIn } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { BUY_ACTIVE, MAX_QTY, addToCart, captureAttribution, cartCount, clearBuyNow, clearCart, openCart, readCart, setBuyNow, useCartState, writeCart } from "./cart";
import { MiniRow, type RecData, bestMinis, pickAddons } from "./CartDrawer";
import type { SfVariant } from "./types";
export { useCartState };

import { rupees } from "@/lib/store-themes";

const useCart = (store: string) => useCartState(store) ?? [];

export function HeaderNav({ store, base, links, keep = "" }: { store: string; base: string; links: Array<{ href: string; label: string }>; keep?: string }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState(false);
  const n = cartCount(useCart(store));
  return (
    <>
      <nav className={`sf-nav${open ? " open" : ""}`} aria-label="Store">
        {links.map((l) => <a key={l.href} href={l.href} onClick={() => setOpen(false)}>{l.label}</a>)}
      </nav>
      <div className="sf-icons">
        <button className="sf-ic" aria-label="Search products" aria-expanded={search} onClick={() => setSearch(!search)}><Search size={20} aria-hidden /></button>
        <a className="sf-ic sf-hide-sm" href={`${base}/track/${keep}`} aria-label="Track order" title="Track order"><Truck size={20} aria-hidden /></a>
        <a className="sf-ic sf-hide-sm" href={`${base}/account/${keep}`} aria-label="My account" title="My account"><User size={20} aria-hidden /></a>
        <a className="sf-cart" href={`${base}/cart/${keep}`} aria-label={`Cart, ${n} item${n === 1 ? "" : "s"}`} onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); window.dispatchEvent(new CustomEvent("sf-cart-open", { detail: { store, browse: true } })); }}>
          <ShoppingBag size={20} aria-hidden />{n > 0 && <span className="n">{n}</span>}
        </a>
        <button className="sf-menu-btn" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} onClick={() => setOpen(!open)}>{open ? <X size={22} /> : <Menu size={22} />}</button>
      </div>
      {search && <SearchBox store={store} base={base} keep={keep} onClose={() => setSearch(false)} />}
    </>
  );
}

/** Photos: swipe on phones (scroll-snap), arrows + thumbnails on desktop, tap/click to zoom full screen. */
/** Header search with live suggestions (name / SKU). Enter or "Search" opens the full results page. */
function SearchBox({ store, base, keep, onClose }: { store: string; base: string; keep: string; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<Array<{ title: string; slug: string; image: string | null }>>([]);
  const [active, setActive] = useState(-1);
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setItems([]); return; }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/store/${store}/search/?q=${encodeURIComponent(term)}`, { signal: ctl.signal }).then((r) => (r.ok ? r.json() : { items: [] }))
        .then((j) => { setItems(Array.isArray(j.items) ? j.items : []); setActive(-1); }).catch(() => {});
    }, 220);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q, store]);
  const keepQ = keep ? `&${keep.slice(1)}` : "";
  return (
    <form className="sf-search" role="search" action={`${base}/shop/`} method="get"
      onKeyDown={(e) => {
        if (e.key === "Escape") { if (q) setQ(""); else onClose(); }
        if (e.key === "ArrowDown" && items.length) { e.preventDefault(); setActive((a) => Math.min(items.length - 1, a + 1)); }
        if (e.key === "ArrowUp" && items.length) { e.preventDefault(); setActive((a) => Math.max(-1, a - 1)); }
        if (e.key === "Enter" && active >= 0 && items[active]) { e.preventDefault(); window.location.href = `${base}/products/${items[active].slug}/${keep}`; }
      }}>
      {keep && [...new URLSearchParams(keep.slice(1)).entries()].map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <label htmlFor="sfq" className="sr-only">Search products</label>
      <div className="sf-search-in">
        <input id="sfq" name="q" className="sf-input" placeholder="Search products" autoFocus maxLength={60} autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)}
          role="combobox" aria-expanded={items.length > 0} aria-controls="sfq-list" aria-activedescendant={active >= 0 ? `sfq-${active}` : undefined} aria-autocomplete="list" />
        {q && <button type="button" className="sf-search-x" onClick={() => setQ("")} aria-label="Clear search"><X size={16} /></button>}
        {items.length > 0 && (
          <ul id="sfq-list" className="sf-suggest" role="listbox">
            {items.map((it, k) => (
              <li key={it.slug} id={`sfq-${k}`} role="option" aria-selected={k === active} className={k === active ? "on" : ""}>
                <a href={`${base}/products/${it.slug}/${keep}`}>{it.image ? <img src={it.image} alt="" width={36} height={36} /> : <span className="ph" />}<span>{it.title}</span></a>
              </li>
            ))}
            <li role="option" aria-selected={false}><a className="all" href={`${base}/shop/?q=${encodeURIComponent(q.trim())}${keepQ}`}>See all results for “{q.trim()}”</a></li>
          </ul>
        )}
      </div>
      <button className="sf-btn">Search</button>
    </form>
  );
}

export function ProductGallery({ images, title }: { images: string[]; title: string }) {
  const [i, setI] = useState(0);
  const [zoom, setZoom] = useState(false);
  const strip = useRef<HTMLDivElement>(null);
  const go = (k: number) => {
    const n = (k + images.length) % images.length;
    setI(n);
    const el = strip.current;
    if (el) el.scrollTo({ left: n * el.clientWidth, behavior: "smooth" });
  };
  useEffect(() => {
    const el = strip.current; if (!el) return;
    const on = () => { const k = Math.round(el.scrollLeft / Math.max(1, el.clientWidth)); if (k >= 0 && k < images.length) setI(k); };
    el.addEventListener("scroll", on, { passive: true });
    return () => el.removeEventListener("scroll", on);
  }, [images.length]);
  // the chosen size / colour has its own photo: show it
  useEffect(() => {
    const on = (e: Event) => { const src = (e as CustomEvent<string>).detail; const k = images.indexOf(src); if (k >= 0) go(k); };
    window.addEventListener("sf-variant-image", on);
    return () => window.removeEventListener("sf-variant-image", on);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!zoom) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZoom(false);
      if (e.key === "ArrowRight") setI((k) => (k + 1) % images.length);
      if (e.key === "ArrowLeft") setI((k) => (k - 1 + images.length) % images.length);
    };
    window.addEventListener("keydown", key); document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", key); document.body.style.overflow = ""; };
  }, [zoom, images.length]);
  if (!images.length) return <div className="main" />;
  return (
    <div className="sf-gal">
      <div className="sf-gal-box">
        <div className="main sf-gal-track" ref={strip} aria-roledescription="carousel" aria-label={`${title} photos`}>
          {images.map((src, k) => (
            <button key={src} type="button" className="sf-gal-slide" onClick={() => { setI(k); setZoom(true); }} aria-label={`Zoom photo ${k + 1} of ${images.length}`}>
              <img src={src} alt={k === 0 ? title : `${title}, photo ${k + 1}`} loading={k === 0 ? "eager" : "lazy"} fetchPriority={k === 0 ? "high" : undefined} width={800} height={800} />
            </button>
          ))}
        </div>
        <span className="sf-gal-zoomhint" aria-hidden><ZoomIn size={16} /></span>
        {images.length > 1 && <>
          <button type="button" className="sf-gal-arrow l" onClick={() => go(i - 1)} aria-label="Previous photo"><ChevronLeft size={20} /></button>
          <button type="button" className="sf-gal-arrow r" onClick={() => go(i + 1)} aria-label="Next photo"><ChevronRight size={20} /></button>
          <div className="sf-gal-dots" aria-hidden>{images.map((src, k) => <span key={src} className={k === i ? "on" : ""} />)}</div>
        </>}
      </div>
      {images.length > 1 && (
        <div className="sf-thumbs">
          {images.map((src, k) => <button key={src} type="button" className={k === i ? "on" : ""} onClick={() => go(k)} aria-label={`Show photo ${k + 1}`} aria-current={k === i}><img src={src} alt="" loading="lazy" /></button>)}
        </div>
      )}
      {zoom && (
        <div className="sf-zoom" role="dialog" aria-modal="true" aria-label={`${title} photo ${i + 1} of ${images.length}`} onClick={() => setZoom(false)}>
          <img src={images[i]} alt={title} onClick={(e) => e.stopPropagation()} />
          <button type="button" className="sf-zoom-x" onClick={() => setZoom(false)} aria-label="Close" autoFocus><X size={22} /></button>
          {images.length > 1 && <>
            <button type="button" className="sf-gal-arrow l" onClick={(e) => { e.stopPropagation(); setI((i - 1 + images.length) % images.length); }} aria-label="Previous photo"><ChevronLeft size={24} /></button>
            <button type="button" className="sf-gal-arrow r" onClick={(e) => { e.stopPropagation(); setI((i + 1) % images.length); }} aria-label="Next photo"><ChevronRight size={24} /></button>
          </>}
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
  const buyRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  // phones: once the buy buttons scroll away, a slim bar with price + buttons stays at the bottom
  useEffect(() => {
    const el = buyRef.current; if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setStuck(!e.isIntersecting && e.boundingClientRect.top < 0), { threshold: 0 });
    io.observe(el); return () => io.disconnect();
  }, []);
  const variant = hasVariants ? product.variants.find((v) => v.values.join("|") === sel.join("|")) ?? null : null;
  const vImage = variant?.image ?? null;
  useEffect(() => { if (vImage) window.dispatchEvent(new CustomEvent("sf-variant-image", { detail: vImage })); }, [vImage]);
  if (!product.inStock) return <p className="sf-oos" style={{ fontSize: 15, margin: "20px 0" }}>Currently out of stock</p>;
  const price = variant?.pricePaise ?? product.pricePaise;
  const canBuy = !hasVariants || !!variant?.inStock;
  function add(go: boolean) {
    if (!canBuy) { setToast(variant ? "This option is out of stock" : `Choose ${product.options.join(" / ").toLowerCase()} first`); setTimeout(() => setToast(""), 2200); return; }
    const line = { productId: product.id, variantId: variant?.id ?? null, variantTitle: variant?.title ?? null, slug: product.slug, title: product.title, image: variant?.image ?? product.image, pricePaise: price };
    // Buy now: only this item goes to checkout; whatever is already in the cart stays there
    if (go) { setBuyNow(store, line, qty); window.location.href = `${base}/checkout/?buy=1`; return; }
    addToCart(store, line, qty);
    openCart(store);
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
      <div className="sf-buy" ref={buyRef}>
        <div className="sf-qty" role="group" aria-label="Quantity">
          <button onClick={() => setQty(Math.max(1, qty - 1))} aria-label="Decrease quantity"><Minus size={16} /></button>
          <span aria-live="polite">{qty}</span>
          <button onClick={() => setQty(Math.min(MAX_QTY, qty + 1))} aria-label="Increase quantity"><Plus size={16} /></button>
        </div>
        <button className="sf-btn" onClick={() => add(false)} disabled={!canBuy}>Add to cart</button>
        <button className="sf-btn ghost" onClick={() => add(true)} disabled={!canBuy}>Buy now</button>
      </div>
      {toast && <div className="sf-toast" role="status">{toast}</div>}
      <div className={`sf-stickybuy${stuck ? " on" : ""}`} aria-hidden={!stuck}>
        <div className="p"><b>{rupees(price)}</b>{variant?.title && <span>{variant.title}</span>}</div>
        <button className="sf-btn" onClick={() => add(false)} tabIndex={stuck ? 0 : -1}>Add to cart</button>
        <button className="sf-btn ghost" onClick={() => add(true)} tabIndex={stuck ? 0 : -1}>Buy now</button>
      </div>
    </>
  );
}

export function CartView({ store, base, checkout, data }: { store: string; base: string; checkout: { codEnabled: boolean; shippingFeePaise: number; freeShippingAbovePaise: number; ready: boolean; demo: boolean }; data?: RecData }) {
  const state = useCartState(store);
  if (state === null) return <p className="sf-note" role="status">Loading your cart…</p>;
  const lines = state;
  const set = (id: string, qty: number) => writeCart(store, readCart(store).flatMap((l) => (l.id !== id ? [l] : qty > 0 ? [{ ...l, qty: Math.min(MAX_QTY, qty) }] : [])));
  if (!lines.length) {
    const best = data ? bestMinis(data, 4) : [];
    return <div className="sf-empty"><p>Your cart is empty.</p><a className="sf-btn" href={`${base}/shop/`}>Continue shopping</a>
      {best.length > 0 && <div className="sf-recs" style={{ maxWidth: 520, margin: "24px auto 0", textAlign: "left" }}><h3>Best sellers</h3>{best.map((p) => <MiniRow key={p.id} store={store} base={base} p={p} list="cart_best_sellers" />)}</div>}</div>;
  }
  const addons = data ? pickAddons(lines, data, 3) : [];
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
        {addons.length > 0 && <div className="sf-recs"><h3>Complete your purchase</h3>{addons.map((p) => <MiniRow key={p.id} store={store} base={base} p={p} list="cart_addons" />)}</div>}
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

/** Top bar while a sale runs, with a live "ends in" countdown. Hides itself when the sale ends. */
export function SaleBar({ text, endsAt }: { text: string; endsAt: string }) {
  const end = new Date(endsAt).getTime();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => { setNow(Date.now()); const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const left = now === null ? null : end - now;
  if (left !== null && left <= 0) return null;
  let label = "";
  if (left !== null) {
    const d = Math.floor(left / 86400_000), h = Math.floor((left % 86400_000) / 3600_000), m = Math.floor((left % 3600_000) / 60_000), s = Math.floor((left % 60_000) / 1000);
    label = d > 0 ? `${d}d ${h}h ${m}m` : `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return <div className="sf-salebar" role="status">{text}{label && <> · ends in <b>{label}</b></>}</div>;
}

const PIN_KEY = "sf_pin";
/** "Delivery by Tue, 25 Nov" for the buyer's pincode. Remembers the pincode in this browser only. */
export function DeliveryCheck({ store, demo }: { store: string; demo?: boolean }) {
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ ok: boolean; text: string; cod?: boolean } | null>(null);
  async function check(p = pin) {
    if (!/^[1-9]\d{5}$/.test(p)) { setRes({ ok: false, text: "Enter a valid 6-digit pincode" }); return; }
    if (demo) { setRes({ ok: true, text: "Delivery in 3-5 days (demo)", cod: true }); return; }
    setBusy(true);
    try {
      const r = await fetch(`/api/store/${store}/edd/?pin=${p}`);
      const j = await r.json();
      if (!r.ok) setRes({ ok: false, text: j?.error?.message ?? "Could not check right now" });
      else if (!j.serviceable) setRes({ ok: false, text: "Sorry, we don't deliver to this pincode yet" });
      else {
        const d = new Date(`${j.date}T00:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
        setRes({ ok: true, text: `Delivery by ${d} (in ${j.days} ${j.days === 1 ? "day" : "days"})`, cod: j.cod });
        try { localStorage.setItem(PIN_KEY, p); } catch { /* private mode */ }
      }
    } catch { setRes({ ok: false, text: "Could not check right now" }); }
    setBusy(false);
  }
  useEffect(() => {
    let saved = "";
    try { saved = localStorage.getItem(PIN_KEY) ?? ""; } catch { /* private mode */ }
    if (/^[1-9]\d{5}$/.test(saved)) { setPin(saved); void check(saved); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div className="sf-edd">
      <b style={{ display: "flex", gap: 6, alignItems: "center" }}><Truck size={16} aria-hidden /> Check delivery date</b>
      <form onSubmit={(e) => { e.preventDefault(); void check(); }}>
        <label htmlFor="sf-pin" className="sr-only">Pincode</label>
        <input id="sf-pin" className="sf-input" inputMode="numeric" maxLength={6} placeholder="Enter pincode" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
        <button className="sf-btn ghost" disabled={busy}>{busy ? "Checking…" : "Check"}</button>
      </form>
      {res && (res.ok
        ? <div role="status"><div className="ok"><CheckCircle2 size={16} aria-hidden /> {res.text}</div>{res.cod !== undefined && <div className="sf-note">{res.cod ? "Cash on Delivery available" : "Prepaid only for this pincode"}</div>}</div>
        : <div className="no" role="status">{res.text}</div>)}
    </div>
  );
}

/** Write a review. Published at once; mobile (optional) only checks for a "Verified buyer" badge. */
export function ReviewForm({ store, productId, demo }: { store: string; productId: string; demo?: boolean }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ rating: 0, title: "", body: "", name: "", mobile: "", website: "" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; err?: string } | null>(null);
  if (demo) return <p className="sf-note">Reviews can be written on real stores.</p>;
  if (!open) return <button className="sf-btn ghost" onClick={() => setOpen(true)}>Write a review</button>;
  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!f.rating) { setMsg({ err: "Pick a star rating" }); return; }
    setBusy(true); setMsg(null);
    const r = await fetch(`/api/store/${store}/reviews/`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...f, productId }) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg({ err: j?.error?.message ?? "Could not post your review" }); return; }
    setMsg({ ok: j.verified ? "Thanks! Your review is live with a Verified buyer badge." : "Thanks! Your review is live." });
    setTimeout(() => window.location.reload(), 1200);
  }
  return (
    <form className="sf-rv-form" onSubmit={send}>
      <div><span className="sf-note">Your rating</span>
        <div className="sf-rate" role="radiogroup" aria-label="Rating">{[1, 2, 3, 4, 5].map((k) => (
          <button type="button" key={k} role="radio" aria-checked={f.rating === k} aria-label={`${k} star${k > 1 ? "s" : ""}`} className={k <= f.rating ? "on" : ""} onClick={() => setF({ ...f, rating: k })}><Star size={26} fill="currentColor" aria-hidden /></button>
        ))}</div></div>
      <label className="sr-only" htmlFor="rv-title">Title</label>
      <input id="rv-title" className="sf-input" placeholder="Title (optional)" maxLength={80} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
      <label className="sr-only" htmlFor="rv-body">Review</label>
      <textarea id="rv-body" className="sf-input" rows={4} placeholder="What did you like or dislike?" maxLength={1500} required value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <label className="sr-only" htmlFor="rv-name">Your name</label>
        <input id="rv-name" className="sf-input" placeholder="Your name" maxLength={40} required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <label className="sr-only" htmlFor="rv-mob">Mobile used for the order</label>
        <input id="rv-mob" className="sf-input" placeholder="Order mobile (optional)" inputMode="numeric" maxLength={13} value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value })} />
      </div>
      <input tabIndex={-1} autoComplete="off" aria-hidden className="sr-only" name="website" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} />
      <span className="sf-note">Your mobile is only used to show a &quot;Verified buyer&quot; badge. It is never shown or shared.</span>
      {msg && <div role="status" className={msg.err ? "no" : ""} style={{ color: msg.err ? "#b91c1c" : "#15803d" }}>{msg.err ?? msg.ok}</div>}
      <div><button className="sf-btn" disabled={busy}>{busy ? "Posting…" : "Post review"}</button></div>
    </form>
  );
}

/** After an online payment is confirmed the buyer lands on the order page: empty the cart and the checkout key there. */
export function ClearCartOnMount({ store }: { store: string }) {
  useEffect(() => {
    let buy = false;
    try { buy = sessionStorage.getItem(BUY_ACTIVE(store)) === "1"; } catch { /* ignore */ }
    // a Buy now order empties only the Buy now item; the cart stays as it was
    if (buy) { clearBuyNow(store); try { sessionStorage.removeItem(`sf-ck:${store}:buy`); } catch { /* ignore */ } return; }
    clearCart(store);
    try { sessionStorage.removeItem(`sf-ck:${store}`); } catch { /* ignore */ }
  }, [store]);
  return null;
}
