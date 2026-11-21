import { ORDERS_PAUSED_TEXT } from "@/lib/store-plan";
import { BadgeCheck, RotateCcw, ShieldCheck, Truck } from "lucide-react";
import { POLICY_KINDS, RADIUS_PX, type StoreSection, fontsHref, rupees } from "@/lib/store-themes";
import type { Storefront } from "@/server/store/public";
import { logoUrl, sectionImage } from "@/server/store/public";
import { AttributionCapture, HeaderNav } from "./StoreClient";
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
      {ann && <div className="sf-bar">{ann.settings.text}</div>}
      <header className="sf-head">
        <div className="sf-wrap">
          <a className="sf-logo" href={`${sf.base}/${keep}`}>{logo ? <img src={logo} alt={sf.name} /> : sf.name}</a>
          <HeaderNav store={sf.slug} base={sf.base} links={links.map((l) => ({ ...l, href: l.href + keep }))} />
        </div>
      </header>
      {!sf.demo && !sf.preview && <><AttributionCapture store={sf.slug} /><StoreTracking store={sf.slug} tags={sf.tags} policyHref={`${sf.base}/policies/privacy/`} /></>}
      <main className="sf-main" id="main">{children}</main>
      <footer className="sf-foot">
        <div className="sf-wrap">
          <div className="cols">
            <div>
              <h3>{sf.name}</h3>
              {sf.settings.tagline && <p style={{ color: "var(--sf-muted)", margin: 0 }}>{sf.settings.tagline}</p>}
              {sf.settings.contact.email && <p style={{ margin: "8px 0 0" }}>{sf.settings.contact.email}</p>}
              {sf.settings.contact.phone && <p style={{ margin: "4px 0 0" }}>{sf.settings.contact.phone}</p>}
            </div>
            <div><h3>Shop</h3><ul><li><a href={`${sf.base}/shop/${keep}`}>All products</a></li>{sf.categories.slice(0, 5).map((cat) => <li key={cat.id}><a href={`${sf.base}/shop/?c=${cat.slug}${keep ? `&${keep.slice(1)}` : ""}`}>{cat.name}</a></li>)}</ul></div>
            <div><h3>Help</h3><ul>
              <li><a href={`${sf.base}/track/${keep}`}>Track order</a></li>
              <li><a href={`${sf.base}/contact/${keep}`}>Contact us</a></li>
              {(Object.keys(POLICY_KINDS) as Array<keyof typeof POLICY_KINDS>).filter((k) => sf.settings.policies[k]).map((k) => <li key={k}><a href={`${sf.base}/policies/${k}/${keep}`}>{POLICY_KINDS[k]}</a></li>)}
            </ul></div>
          </div>
          <div className="fine"><span>© {new Date().getFullYear()} {sf.name}</span><span>Powered by Vishwaship</span></div>
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

export function ProductCard({ p, base, q = "" }: { p: SfProduct; base: string; q?: string }) {
  return (
    <a className="sf-card" href={`${base}/products/${p.slug}/${q}`}>
      <div className="img">{p.images[0] ? <img src={p.images[0]} alt={p.title} loading="lazy" /> : null}</div>
      <span className="t">{p.title}</span>
      <Price p={p} />
      {!p.inStock && <span className="sf-oos">Out of stock</span>}
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
      const img = sectionImage(v.image) ?? (sf.demo ? "/store-demo/hero.svg" : null);
      return (
        <section className={`sf-hero${v.align === "center" ? " center" : ""}`}>
          <div className="sf-wrap">
            <div>
              <h1>{v.heading || sf.name}</h1>
              {v.subheading && <p>{v.subheading}</p>}
              <a className="sf-btn" href={`${sf.base}/shop/${keep}`}>{v.button || "Shop now"}</a>
            </div>
            {img && <img src={img} alt="" />}
          </div>
        </section>
      );
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
      const list = [...sf.products].sort((a, b) => Number(b.featured) - Number(a.featured)).slice(0, n);
      return (
        <section className="sf-sec"><div className="sf-wrap">
          <h2>{v.heading || "Featured products"}</h2>
          {list.length ? <div className="sf-grid">{list.map((p) => <ProductCard key={p.id} p={p} base={sf.base} q={keep} />)}</div> : <p className="sf-note">Products will appear here soon.</p>}
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
