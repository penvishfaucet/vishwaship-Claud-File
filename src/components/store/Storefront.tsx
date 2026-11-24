import { ORDERS_PAUSED_TEXT } from "@/lib/store-plan";
import { BadgeCheck, Facebook, Instagram, MessageCircle, RotateCcw, ShieldCheck, Star, Truck, Youtube } from "lucide-react";
import { POLICY_KINDS, RADIUS_PX, type StoreSection, fontsHref, heroSlides, rupees } from "@/lib/store-themes";
import { HeroSlider } from "./HeroSlider";
import type { Storefront } from "@/server/store/public";
import { bestSellers, cartCheckoutInfo, logoUrl, recData, sectionImage } from "@/server/store/public";
import { CartDrawer } from "./CartDrawer";
import { AttributionCapture, HeaderNav, SaleBar } from "./StoreClient";
import { StoreTracking } from "./Tracking";
import type { SfProduct } from "./types";
import "@/styles/store.css";

/** Store chrome: theme variables, announcement, header, footer. Used by every storefront page. */
export function StoreShell({ sf, children }: { sf: Storefront; children: React.ReactNode }) {
  const c = sf.theme;
  const style = {
    "--sf-primary": c.colors.primary, "--sf-accent": c.colors.accent, "--sf-bg": c.colors.background, "--sf-text": c.colors.text,
    "--sf-radius": RADIUS_PX[c.radius], "--sf-hfont": `"${c.fonts.heading}"`, "--sf-bfont": `"${c.fonts.body}"`,
  } as React.CSSProperties;
  const ann = c.sections.find((s) => s.type === "announcement" && s.enabled && s.settings.text);
  const logo = logoUrl(sf);
  const links = [
    { href: `${sf.base}/`, label: "Home" }, { href: `${sf.base}/shop/`, label: "Shop" },
    { href: `${sf.base}/about/`, label: "About" }, { href: `${sf.base}/contact/`, label: "Contact" }, { href: `${sf.base}/track/`, label: "Track order" },
  ];
  const keep = sf.demo ? `?theme=${sf.themeKey}` : sf.preview ? "?preview=1" : "";
  return (
    <div className="sf" style={style}>
      {/* eslint-disable-next-line @next/next/no-page-custom-font */}
      <link rel="stylesheet" href={fontsHref(c)} />
      {sf.preview && <div className="sf-preview" role="status">Preview — buyers can't see unpublished changes. <a href="/portal/store/theme/" target="_top">Back to editor</a></div>}
      {sf.demo && <div className="sf-preview" role="status">Demo store — <a href="/online-store/">create your own store</a>. Try themes: {["bazaar", "minimal", "boutique", "fresh"].map((k, i) => <span key={k}>{i ? " · " : " "}<a href={`?theme=${k}`}>{k}</a></span>)}</div>}
      {!sf.ordersOpen && !sf.preview && <div className="sf-bar" role="status">{ORDERS_PAUSED_TEXT}</div>}
      {sf.sale && sf.ordersOpen && <SaleBar text={sf.sale.text} endsAt={sf.sale.endsAt} />}
      {ann && <div className="sf-bar">{ann.settings.text}</div>}
      <header className="sf-head">
        <div className="sf-wrap">
          <a className="sf-logo" href={`${sf.base}/${keep}`}>{logo ? <img src={logo} alt={sf.name} /> : sf.name}</a>
          <HeaderNav store={sf.slug} base={sf.base} keep={keep} links={links.map((l) => ({ ...l, href: l.href + keep }))} />
        </div>
      </header>
      {!sf.demo && !sf.preview && <><AttributionCapture store={sf.slug} /><StoreTracking store={sf.slug} tags={sf.tags} policyHref={`${sf.base}/policies/privacy/`} /></>}
      <main className="sf-main" id="main">{children}</main>
      <CartDrawer store={sf.slug} base={sf.base} checkout={cartCheckoutInfo(sf)} data={recData(sf)} />
      <footer className="sf-foot">
        <div className="sf-wrap">
          <div className="cols">
            <div>
              <a className="sf-logo" href={`${sf.base}/${keep}`}>{logo ? <img src={logo} alt={sf.name} /> : sf.name}</a>
              {sf.settings.tagline && <p style={{ color: "var(--sf-muted)", margin: "10px 0 0", maxWidth: 320 }}>{sf.settings.tagline}</p>}
              <Social sf={sf} />
            </div>
            <div><h3>Shop</h3><ul><li><a href={`${sf.base}/shop/${keep}`}>All products</a></li>{sf.categories.slice(0, 5).map((cat) => <li key={cat.id}><a href={`${sf.base}/shop/?c=${cat.slug}${keep ? `&${keep.slice(1)}` : ""}`}>{cat.name}</a></li>)}</ul></div>
            <div><h3>Help</h3><ul>
              <li><a href={`${sf.base}/track/${keep}`}>Track order</a></li>
              <li><a href={`${sf.base}/contact/${keep}`}>Contact us</a></li>
              {(Object.keys(POLICY_KINDS) as Array<keyof typeof POLICY_KINDS>).filter((k) => sf.settings.policies[k]).map((k) => <li key={k}><a href={`${sf.base}/policies/${k}/${keep}`}>{POLICY_KINDS[k]}</a></li>)}
            </ul></div>
            {(sf.settings.contact.phone || sf.settings.contact.email || sf.settings.contact.address) && (
              <div><h3>Contact</h3><ul>
                {sf.settings.contact.phone && <li><a href={`tel:${sf.settings.contact.phone.replace(/[^\d+]/g, "")}`}>{sf.settings.contact.phone}</a></li>}
                {sf.settings.contact.email && <li><a href={`mailto:${sf.settings.contact.email}`}>{sf.settings.contact.email}</a></li>}
                {sf.settings.contact.address && <li style={{ whiteSpace: "pre-line" }}>{sf.settings.contact.address}</li>}
              </ul></div>
            )}
          </div>
          <div className="sf-paybadges" aria-label="Ways to pay">{sf.settings.checkout.codEnabled && <span>Cash on Delivery</span>}{sf.onlinePay && <><span>UPI</span><span>Cards</span><span>Net banking</span></>}</div>
          <div className="fine"><span>© {new Date().getFullYear()} {sf.name}. All rights reserved.</span><span>Powered by Vishwaship</span></div>
        </div>
      </footer>
    </div>
  );
}

const pct = (p: SfProduct) => (p.comparePaise && p.comparePaise > p.pricePaise ? Math.round((1 - p.pricePaise / p.comparePaise) * 100) : 0);

export function Price({ p }: { p: SfProduct }) {
  return (
    <div className="sf-price">
      <b>{rupees(p.pricePaise)}</b>
      {pct(p) > 0 && <><s>{rupees(p.comparePaise!)}</s><span className="off">{pct(p)}% off</span></>}
    </div>
  );
}

export function Stars({ avg, count }: { avg: number; count?: number }) {
  return (
    <span className="sf-stars" aria-label={`Rated ${avg} out of 5${count ? `, ${count} reviews` : ""}`}>
      {[1, 2, 3, 4, 5].map((k) => <Star key={k} size={13} fill={k <= Math.round(avg) ? "currentColor" : "none"} aria-hidden />)}
      {count !== undefined && <span className="c">({count})</span>}
    </span>
  );
}

export function ProductCard({ p, base, q = "" }: { p: SfProduct; base: string; q?: string }) {
  return (
    <a className="sf-card" href={`${base}/products/${p.slug}/${q}`}>
      {p.sale && <span className="sale">{p.sale.percentOff}% OFF</span>}
      <div className="img">{p.images[0] ? <img src={p.images[0]} alt={p.title} loading="lazy" /> : null}</div>
      <span className="t">{p.title}</span>
      {p.rating && <Stars avg={p.rating.avg} count={p.rating.count} />}
      <Price p={p} />
      {!p.inStock ? <span className="sf-oos">Out of stock</span> : p.options.length > 0 ? <span className="sf-note">{p.variants.length} options</span> : null}
    </a>
  );
}

const BADGE_ICONS = [Truck, BadgeCheck, ShieldCheck, RotateCcw];

export function Sections({ sf }: { sf: Storefront }) {
  const keep = sf.demo ? `?theme=${sf.themeKey}` : sf.preview ? "?preview=1" : "";
  return <>{sf.theme.sections.filter((s) => s.enabled && s.type !== "announcement").map((s) => <Section key={s.id} s={s} sf={sf} keep={keep} />)}</>;
}

function Section({ s, sf, keep }: { s: StoreSection; sf: Storefront; keep: string }) {
  const v = s.settings;
  switch (s.type) {
    case "hero": {
      const slides = heroSlides(v, sf.base, sf.name).map((s, k) => ({
        ...s, image: sectionImage(s.image) ?? (sf.demo && k === 0 ? "/store-demo/hero.svg" : null),
        buttons: s.buttons.map((b) => ({ ...b, href: keep && b.href.startsWith(sf.base) ? `${b.href}${b.href.includes("?") ? "&" : "?"}${keep.slice(1)}` : b.href })),
      }));
      const secs = Number.parseInt(v.autoplay ?? "5", 10);
      return <HeroSlider slides={slides} intervalMs={Number.isFinite(secs) ? secs * 1000 : 0} center={v.align === "center"} />;
    }
    case "trust_badges": {
      const items = (v.items ?? "").split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 4);
      if (!items.length) return null;
      return <div className="sf-wrap"><div className="sf-badges">{items.map((t, i) => { const I = BADGE_ICONS[i % 4]; return <div key={t}><I size={18} aria-hidden />{t}</div>; })}</div></div>;
    }
    case "categories":
      if (!sf.categories.length) return null;
      return (
        <section className="sf-sec"><div className="sf-wrap">
          <h2>{v.heading || "Shop by category"}</h2>
          <div className="sf-cats">{sf.categories.map((c) => <a key={c.id} className="sf-cat" href={`${sf.base}/shop/?c=${c.slug}${keep ? `&${keep.slice(1)}` : ""}`}>{c.name}</a>)}</div>
        </div></section>
      );
    case "featured_products": {
      const n = Number(v.count) || 8;
      const list = [...sf.products].sort((a, b) => Number(b.featured) - Number(a.featured) || b.sold - a.sold).slice(0, n);
      return (
        <section className="sf-sec"><div className="sf-wrap">
          <h2>{v.heading || "Featured products"}</h2>
          {list.length ? <div className="sf-grid">{list.map((p) => <ProductCard key={p.id} p={p} base={sf.base} q={keep} />)}</div> : <p className="sf-note">Products will appear here soon.</p>}
        </div></section>
      );
    }
    case "best_sellers": {
      const n = Number(v.count) || 8;
      const list = bestSellers(sf.products, n);
      if (!list.length) return null;
      return (
        <section className="sf-sec"><div className="sf-wrap">
          <div className="sf-sec-h"><h2>{v.heading || "Best sellers"}</h2><a className="sf-link" href={`${sf.base}/shop/?sort=best${keep ? `&${keep.slice(1)}` : ""}`}>View all</a></div>
          <div className="sf-grid">{list.map((p) => <ProductCard key={p.id} p={p} base={sf.base} q={keep} />)}</div>
        </div></section>
      );
    }
    case "image_text": {
      const img = sectionImage(v.image) ?? (sf.demo ? "/store-demo/craft.svg" : null);
      return (
        <section className="sf-sec"><div className="sf-wrap sf-it">
          {img ? <img src={img} alt="" /> : <div className="ph" />}
          <div><h2>{v.heading}</h2><p>{v.body}</p></div>
        </div></section>
      );
    }
    case "testimonials": {
      const items = (v.items ?? "").split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 6).map((line) => {
        const [q, who] = line.split(/\s+[—-]\s+/);
        return { q, who: who ?? "" };
      });
      if (!items.length) return null;
      return (
        <section className="sf-sec"><div className="sf-wrap">
          <h2>{v.heading || "What customers say"}</h2>
          <div className="sf-reviews">{items.map((t) => <blockquote key={t.q}>“{t.q}”{t.who && <cite>{t.who}</cite>}</blockquote>)}</div>
        </div></section>
      );
    }
    default:
      return null;
  }
}

const SOCIAL = [
  { k: "instagram", I: Instagram, label: "Instagram" }, { k: "facebook", I: Facebook, label: "Facebook" }, { k: "youtube", I: Youtube, label: "YouTube" },
] as const;
/** Social links from Pages & SEO. Only https links are shown; WhatsApp becomes a wa.me chat link. */
function Social({ sf }: { sf: Storefront }) {
  const s = sf.settings.social;
  const wa = (s.whatsapp || sf.settings.contact.whatsapp).replace(/\D/g, "").slice(-10);
  const items = SOCIAL.filter((x) => /^https:\/\/[^\s"'<>]+$/i.test(s[x.k]));
  if (!items.length && wa.length !== 10) return null;
  return (
    <div className="sf-social">
      {items.map(({ k, I, label }) => <a key={k} href={s[k]} target="_blank" rel="noopener noreferrer" aria-label={label}><I size={18} aria-hidden /></a>)}
      {wa.length === 10 && <a href={`https://wa.me/91${wa}`} target="_blank" rel="noopener noreferrer" aria-label="WhatsApp"><MessageCircle size={18} aria-hidden /></a>}
    </div>
  );
}
