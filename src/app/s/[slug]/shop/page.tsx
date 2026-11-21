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
  const term = (typeof sp.q === "string" ? sp.q : "").trim().toLowerCase().slice(0, 60);
  let list = cat ? sf.products.filter((p) => p.categorySlug === cat.slug) : sf.products;
  if (term) list = list.filter((p) => `${p.title} ${p.description}`.toLowerCase().includes(term));
  if (sort === "price_asc") list = [...list].sort((a, b) => a.pricePaise - b.pricePaise);
  if (sort === "price_desc") list = [...list].sort((a, b) => b.pricePaise - a.pricePaise);
  const PER = 48;
  const pages = Math.max(1, Math.ceil(list.length / PER));
  const pageNo = Math.min(pages, Math.max(1, Number.parseInt(typeof sp.page === "string" ? sp.page : "1", 10) || 1));
  const shown = list.slice((pageNo - 1) * PER, pageNo * PER);
  const keep = keepQs(sf);
  const q = (o: Record<string, string>) => { const u = new URLSearchParams(keep); for (const [k, v] of Object.entries(o)) if (v) u.set(k, v); const s = u.toString(); return s ? `?${s}` : ""; };
  return (
    <StoreShell sf={sf}>
      <div className="sf-wrap sf-page">
        <h1>{term ? `Results for “${term}”` : cat ? cat.name : "All products"}</h1>
        <div className="sf-filters">
          <a className={`sf-chip${!cat ? " on" : ""}`} href={`${sf.base}/shop/${q({ sort })}`}>All</a>
          {sf.categories.map((c) => <a key={c.id} className={`sf-chip${cat?.id === c.id ? " on" : ""}`} href={`${sf.base}/shop/${q({ c: c.slug, sort })}`}>{c.name}</a>)}
          <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <a className={`sf-chip${sort === "price_asc" ? " on" : ""}`} href={`${sf.base}/shop/${q({ c: cat?.slug ?? "", sort: "price_asc" })}`}>Price: low to high</a>
            <a className={`sf-chip${sort === "price_desc" ? " on" : ""}`} href={`${sf.base}/shop/${q({ c: cat?.slug ?? "", sort: "price_desc" })}`}>Price: high to low</a>
          </span>
        </div>
        {list.length > 0 && <p className="sf-note" style={{ marginTop: -8 }}>{list.length} products{pages > 1 ? ` · page ${pageNo} of ${pages}` : ""}</p>}
        {shown.length ? <div className="sf-grid">{shown.map((p) => <ProductCard key={p.id} p={p} base={sf.base} q={keep ? `?${keep}` : ""} />)}</div> : <p className="sf-empty">{term ? "No products match your search." : "No products here yet."}</p>}
        {pages > 1 && (
          <nav className="sf-filters" aria-label="Pages" style={{ justifyContent: "center", marginTop: 28 }}>
            {pageNo > 1 && <a className="sf-chip" href={`${sf.base}/shop/${q({ c: cat?.slug ?? "", sort, q: term, page: String(pageNo - 1) })}`} rel="prev">← Previous</a>}
            {Array.from({ length: pages }, (_, i) => i + 1).filter((n) => n === 1 || n === pages || Math.abs(n - pageNo) <= 2).map((n, i, arr) => (
              <span key={n} style={{ display: "contents" }}>
                {i > 0 && n - arr[i - 1] > 1 && <span className="sf-note" aria-hidden>…</span>}
                <a className={`sf-chip${n === pageNo ? " on" : ""}`} aria-current={n === pageNo ? "page" : undefined} href={`${sf.base}/shop/${q({ c: cat?.slug ?? "", sort, q: term, page: n > 1 ? String(n) : "" })}`}>{n}</a>
              </span>
            ))}
            {pageNo < pages && <a className="sf-chip" href={`${sf.base}/shop/${q({ c: cat?.slug ?? "", sort, q: term, page: String(pageNo + 1) })}`} rel="next">Next →</a>}
          </nav>
        )}
      </div>
    </StoreShell>
  );
}
