import { notFound } from "next/navigation";
import { AddToCart, ProductGallery } from "@/components/store/StoreClient";
import { Price, ProductCard, StoreShell } from "@/components/store/Storefront";
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
  const related = sf.products.filter((x) => x.id !== p.id && x.categorySlug === p.categorySlug).slice(0, 4);
  const keep = keepQs(sf) ? `?${keepQs(sf)}` : "";
  const ld = {
    "@context": "https://schema.org", "@type": "Product", name: p.title, description: p.description, image: p.images,
    offers: { "@type": "Offer", priceCurrency: "INR", price: (p.pricePaise / 100).toFixed(2), availability: p.inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock" },
  };
  return (
    <StoreShell sf={sf}>
      <div className="sf-wrap sf-page">
        <nav className="sf-crumb" aria-label="Breadcrumb"><a href={`${sf.base}/${keep}`}>Home</a> / <a href={`${sf.base}/shop/${keep}`}>Shop</a>{cat && <> / <span>{cat.name}</span></>}</nav>
        <div className="sf-pdp">
          <ProductGallery images={p.images} title={p.title} />
          <div>
            <h1>{p.title}</h1>
            {p.options.length === 0 && <Price p={p} />}
            {p.options.length === 0 && <p className="sf-note" style={{ marginTop: 4 }}>Inclusive of all taxes</p>}
            <AddToCart store={sf.slug} base={sf.base} product={{ id: p.id, slug: p.slug, title: p.title, image: p.images[0] ?? null, pricePaise: p.pricePaise, comparePaise: p.comparePaise, inStock: p.inStock, options: p.options, variants: p.variants }} />
            {p.description && <div className="sf-prose" style={{ marginBottom: 20 }}>{p.description}</div>}
            <ul className="sf-perks">
              {sf.settings.checkout.codEnabled && <li>Cash on Delivery available</li>}
              <li>Ships across India with live tracking</li>
              {sf.settings.policies.refund && <li><a href={`${sf.base}/policies/refund/${keep}`} style={{ textDecoration: "underline" }}>Returns policy</a></li>}
            </ul>
          </div>
        </div>
        {related.length > 0 && <section className="sf-sec"><h2>You may also like</h2><div className="sf-grid">{related.map((r) => <ProductCard key={r.id} p={r} base={sf.base} q={keep} />)}</div></section>}
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld).replace(/</g, "\\u003c") }} />
    </StoreShell>
  );
}
