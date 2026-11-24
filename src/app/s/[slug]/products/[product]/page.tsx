import { notFound } from "next/navigation";
import { AddToCart, DeliveryCheck, ProductGallery, ReviewForm } from "@/components/store/StoreClient";
import { productReviews } from "@/server/store/reviews";
import { Price, ProductCard, Stars, StoreShell } from "@/components/store/Storefront";
import { MiniRow } from "@/components/store/CartDrawer";
import { bestSellers, mini } from "@/server/store/public";
import { TrackOnMount } from "@/components/store/Tracking";
import { type SfSearch, keepQs, resolveSf, sfMeta } from "../../_sf";

export const dynamic = "force-dynamic";
type P = Promise<{ slug: string; product: string }>;

export async function generateMetadata({ params, searchParams }: { params: P; searchParams: SfSearch }) {
  const sf = await resolveSf(params, searchParams);
  const { product } = await params;
  const p = sf.products.find((x) => x.slug === product);
  if (!p) return {};
  const m = await sfMeta(sf, `/products/${p.slug}/`, p.seo.title || p.title, p.seo.description || p.description.slice(0, 160));
  return { ...m, openGraph: { ...m.openGraph, images: p.images[0] ? [p.images[0]] : undefined } };
}

export default async function ProductPage({ params, searchParams }: { params: P; searchParams: SfSearch }) {
  const sf = await resolveSf(params, searchParams);
  const { product } = await params;
  const p = sf.products.find((x) => x.slug === product);
  if (!p) notFound();
  const cat = sf.categories.find((c) => c.slug === p.categorySlug);
  // Frequently bought together: merchant-chosen compatible add-ons first, then often bought in the same order
  const addons = p.addons.map((id) => sf.products.find((x) => x.id === id)).filter((x): x is NonNullable<typeof x> => !!x && x.inStock).slice(0, 3);
  // You may also like: same category (best sellers first), never the product itself or its add-ons; thin categories fill up with store best sellers
  const skip = new Set([p.id, ...addons.map((x) => x.id)]);
  const sameCat = p.categorySlug ? bestSellers(sf.products, 24, p.categorySlug).filter((x) => !skip.has(x.id)) : [];
  const related = [...sameCat, ...bestSellers(sf.products, 12).filter((x) => !skip.has(x.id) && !sameCat.includes(x))].slice(0, 4);
  const keep = keepQs(sf) ? `?${keepQs(sf)}` : "";
  const reviews = sf.demo ? [] : await productReviews(sf.id, p.id);
  const ld = {
    "@context": "https://schema.org", "@type": "Product", name: p.title, description: p.description, image: p.images,
    ...(p.attributes.length ? { additionalProperty: p.attributes.map((a) => ({ "@type": "PropertyValue", name: a.name, value: a.value })) } : {}),
    offers: { "@type": "Offer", priceCurrency: "INR", price: (p.pricePaise / 100).toFixed(2), availability: p.inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock" },
    ...(p.rating ? { aggregateRating: { "@type": "AggregateRating", ratingValue: p.rating.avg, reviewCount: p.rating.count } } : {}),
  };
  return (
    <StoreShell sf={sf}>
      <div className="sf-wrap sf-page">
        <nav className="sf-crumb" aria-label="Breadcrumb"><a href={`${sf.base}/${keep}`}>Home</a> / <a href={`${sf.base}/shop/${keep}`}>Shop</a>{cat && <> / <span>{cat.name}</span></>}</nav>
        <div className="sf-pdp">
          <ProductGallery images={p.images} title={p.title} />
          <div>
            <h1>{p.title}</h1>
            {p.rating && <a href="#reviews" style={{ display: "inline-block", marginBottom: 8 }}><Stars avg={p.rating.avg} count={p.rating.count} /></a>}
            {p.sale && <p style={{ margin: "0 0 6px", fontWeight: 700, color: "var(--sf-primary)" }}>{p.sale.name}: {p.sale.percentOff}% off</p>}
            {p.options.length === 0 && <Price p={p} />}
            {p.options.length === 0 && <p className="sf-note" style={{ marginTop: 4 }}>Inclusive of all taxes</p>}
            {p.details.highlights.trim() && <ul className="sf-hl">{p.details.highlights.split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 8).map((x) => <li key={x}>{x}</li>)}</ul>}
            <AddToCart store={sf.slug} base={sf.base} product={{ id: p.id, slug: p.slug, title: p.title, image: p.images[0] ?? null, pricePaise: p.pricePaise, comparePaise: p.comparePaise, inStock: p.inStock, options: p.options, variants: p.variants }} />
            {addons.length > 0 && (
              <div className="sf-recs sf-fbt"><h3>Frequently bought together</h3>{addons.map((x) => <MiniRow key={x.id} store={sf.slug} base={sf.base} p={mini(x)} list="pdp_bought_together" />)}</div>
            )}
            {sf.offers.length > 0 && (
              <div className="sf-offers"><b>Offers</b>{sf.offers.map((o) => <div key={o.code}><b className="code">{o.code}</b>{o.text}</div>)}<span className="sf-note">Apply the code at checkout.</span></div>
            )}
            <DeliveryCheck store={sf.slug} demo={sf.demo} />
            {p.description && <div className="sf-prose" style={{ marginBottom: 20 }}>{p.description}</div>}
            {(() => {
              const specs = [...p.attributes.map((a) => ({ label: a.name, value: a.value })), ...p.details.specs];
              const parts: Array<[string, React.ReactNode]> = [];
              if (specs.length) parts.push(["Specifications", <table key="t" className="sf-specs"><tbody>{specs.map((x, i) => <tr key={i}><th scope="row">{x.label}</th><td>{x.value}</td></tr>)}</tbody></table>]);
              if (p.details.usage.trim()) parts.push(["How to use", <p key="u" className="sf-prose">{p.details.usage}</p>]);
              if (p.details.inBox.trim()) parts.push(["What's in the box", <p key="b" className="sf-prose">{p.details.inBox}</p>]);
              if (p.details.care.trim()) parts.push(["Care", <p key="c" className="sf-prose">{p.details.care}</p>]);
              if (p.details.warranty.trim()) parts.push(["Warranty", <p key="w" className="sf-prose">{p.details.warranty}</p>]);
              return parts.length ? <div className="sf-acc">{parts.map(([t, body], i) => <details key={t} open={i === 0}><summary>{t}</summary><div>{body}</div></details>)}</div> : null;
            })()}
            <ul className="sf-perks">
              {sf.settings.checkout.codEnabled && <li>Cash on Delivery available</li>}
              <li>Ships across India with live tracking</li>
              {sf.settings.policies.refund && <li><a href={`${sf.base}/policies/refund/${keep}`} style={{ textDecoration: "underline" }}>Returns policy</a></li>}
            </ul>
          </div>
        </div>
        <section className="sf-sec" id="reviews" style={{ paddingBottom: 0 }}>
          <h2>Customer reviews</h2>
          <div className="sf-rv-sum">
            {p.rating ? <><span className="big">{p.rating.avg.toFixed(1)}</span><div><Stars avg={p.rating.avg} /><div className="sf-note">{p.rating.count} {p.rating.count === 1 ? "review" : "reviews"}</div></div></> : <span className="sf-note">No reviews yet. Be the first to review this product.</span>}
            <span style={{ marginLeft: "auto" }}><ReviewForm store={sf.slug} productId={p.id} demo={sf.demo} /></span>
          </div>
          <div className="sf-rv-list">{reviews.map((r) => (
            <article className="sf-rv" key={r.id}>
              <Stars avg={r.rating} />{r.title && <b style={{ marginLeft: 8 }}>{r.title}</b>}
              <p style={{ margin: "6px 0 0", whiteSpace: "pre-line" }}>{r.body}</p>
              <div className="who">{r.name}{r.verified && <span className="vb">✓ Verified buyer</span>} · {r.createdAt.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</div>
            </article>
          ))}</div>
        </section>
        {related.length > 0 && <section className="sf-sec"><h2>You may also like</h2><div className="sf-grid">{related.map((r) => <ProductCard key={r.id} p={r} base={sf.base} q={keep} />)}</div></section>}
      </div>
      <TrackOnMount event={{ name: "view_item", item: { id: p.id, name: p.title, price: p.pricePaise / 100, qty: 1 } }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, "\\u003c") }} />
    </StoreShell>
  );
}
