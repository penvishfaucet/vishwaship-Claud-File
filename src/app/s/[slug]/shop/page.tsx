import { ProductCard, StoreShell } from "@/components/store/Storefront";
import { type SfParams, type SfSearch, keepQs, resolveSf, sfMeta } from "../_sf";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params, searchParams }: { params: SfParams; searchParams: SfSearch }) {
  const sf = await resolveSf(params, searchParams);
  const sp = await searchParams;
  const c = sf.categories.find((x) => x.slug === sp.c);
  return sfMeta(sf, c ? `/shop/?c=${c.slug}` : "/shop/", c ? c.name : "Shop");
}

export default async function Shop({ params, searchParams }: { params: SfParams; searchParams: SfSearch }) {
  const sf = await resolveSf(params, searchParams);
  const sp = await searchParams;
  const cat = sf.categories.find((x) => x.slug === sp.c) ?? null;
  const sort = typeof sp.sort === "string" ? sp.sort : "";
  let list = cat ? sf.products.filter((p) => p.categorySlug === cat.slug) : sf.products;
  if (sort === "price_asc") list = [...list].sort((a, b) => a.pricePaise - b.pricePaise);
  if (sort === "price_desc") list = [...list].sort((a, b) => b.pricePaise - a.pricePaise);
  const keep = keepQs(sf);
  const q = (o: Record<string, string>) => { const u = new URLSearchParams(keep); for (const [k, v] of Object.entries(o)) if (v) u.set(k, v); const s = u.toString(); return s ? `?${s}` : ""; };
  return (
    <StoreShell sf={sf}>
      <div className="sf-wrap sf-page">
        <h1>{cat ? cat.name : "All products"}</h1>
        <div className="sf-filters">
          <a className={`sf-chip${!cat ? " on" : ""}`} href={`${sf.base}/shop/${q({ sort })}`}>All</a>
          {sf.categories.map((c) => <a key={c.id} className={`sf-chip${cat?.id === c.id ? " on" : ""}`} href={`${sf.base}/shop/${q({ c: c.slug, sort })}`}>{c.name}</a>)}
          <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <a className={`sf-chip${sort === "price_asc" ? " on" : ""}`} href={`${sf.base}/shop/${q({ c: cat?.slug ?? "", sort: "price_asc" })}`}>Price: low to high</a>
            <a className={`sf-chip${sort === "price_desc" ? " on" : ""}`} href={`${sf.base}/shop/${q({ c: cat?.slug ?? "", sort: "price_desc" })}`}>Price: high to low</a>
          </span>
        </div>
        {list.length ? <div className="sf-grid">{list.map((p) => <ProductCard key={p.id} p={p} base={sf.base} q={keep ? `?${keep}` : ""} />)}</div> : <p className="sf-empty">No products here yet.</p>}
      </div>
    </StoreShell>
  );
}
