import { ProductCard, StoreShell } from "@/components/store/Storefront";
import { bestSellers } from "@/server/store/public";

const SORTS: Array<[string, string]> = [["", "Featured"], ["best", "Best selling"], ["new", "Newest"], ["price_asc", "Price: low to high"], ["price_desc", "Price: high to low"]];
const rupee = (v: unknown) => { const n = Number.parseInt(typeof v === "string" ? v : "", 10); return Number.isFinite(n) && n >= 0 && n < 10_000_000 ? n : null; };
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
  const sort = typeof sp.sort === "string" && SORTS.some(([k]) => k === sp.sort) ? sp.sort : "";
  const term = (typeof sp.q === "string" ? sp.q : "").trim().toLowerCase().slice(0, 60);
  const inStock = sp.stock === "1";
  const min = rupee(sp.min), max = rupee(sp.max);
  let list = cat ? sf.products.filter((p) => p.categorySlug === cat.slug) : sf.products;
  // search: every word must match the name, description or category (so "brass tap" finds "Brass Pillar Tap")
  if (term) {
    const words = term.split(/\s+/).filter(Boolean);
    const catName = new Map(sf.categories.map((c) => [c.slug, c.name]));
    list = list.filter((p) => { const hay = `${p.title} ${p.description} ${p.categorySlug ? catName.get(p.categorySlug) ?? "" : ""}`.toLowerCase(); return words.every((w) => hay.includes(w)); });
  }
  if (inStock) list = list.filter((p) => p.inStock);
  if (min !== null) list = list.filter((p) => p.pricePaise >= min * 100);
  if (max !== null) list = list.filter((p) => p.pricePaise <= max * 100);
  if (sort === "price_asc") list = [...list].sort((a, b) => a.pricePaise - b.pricePaise);
  if (sort === "price_desc") list = [...list].sort((a, b) => b.pricePaise - a.pricePaise);
  if (sort === "new") list = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (sort === "best") list = [...list].sort((a, b) => b.sold - a.sold || Number(b.featured) - Number(a.featured));
  const filtersOn = inStock || min !== null || max !== null;
  // Best sellers of this category, above the grid (first page, no search / filters)
  const catBest = cat && !term && !filtersOn && !sort && (typeof sp.page !== "string" || sp.page === "1") ? bestSellers(sf.products, 4, cat.slug).filter((p) => p.sold > 0) : [];
  const PER = 48;
  const pages = Math.max(1, Math.ceil(list.length / PER));
  const pageNo = Math.min(pages, Math.max(1, Number.parseInt(typeof sp.page === "string" ? sp.page : "1", 10) || 1));
  const shown = list.slice((pageNo - 1) * PER, pageNo * PER);
  const keep = keepQs(sf);
  const q = (o: Record<string, string>) => { const u = new URLSearchParams(keep); for (const [k, v] of Object.entries(o)) if (v) u.set(k, v); const s = u.toString(); return s ? `?${s}` : ""; };
  const cur = { c: cat?.slug ?? "", q: term, sort, stock: inStock ? "1" : "", min: min !== null ? String(min) : "", max: max !== null ? String(max) : "" };
  return (
    <StoreShell sf={sf}>
      <div className="sf-wrap sf-page">
        <h1>{term ? `Results for “${term}”` : cat ? cat.name : "All products"}</h1>
        <div className="sf-filters sf-catrow">
          <a className={`sf-chip${!cat ? " on" : ""}`} href={`${sf.base}/shop/${q({ ...cur, c: "" })}`}>All</a>
          {sf.categories.map((c) => <a key={c.id} className={`sf-chip${cat?.id === c.id ? " on" : ""}`} href={`${sf.base}/shop/${q({ ...cur, c: c.slug })}`}>{c.name}</a>)}
        </div>
        {/* sort + filters: a plain GET form (works without JavaScript); on phones it folds into a "Filter & sort" drawer */}
        <details className="sf-fdrawer" open={filtersOn || undefined}>
          <summary className="sf-btn ghost">Filter &amp; sort{filtersOn ? " · on" : ""}</summary>
          <form className="sf-fbar" method="get" action={`${sf.base}/shop/`}>
            {[...new URLSearchParams(keep).entries()].map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            {cat && <input type="hidden" name="c" value={cat.slug} />}
            {term && <input type="hidden" name="q" value={term} />}
            <label>Sort by<select className="sf-input" name="sort" defaultValue={sort}>{SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label>Min ₹<input className="sf-input" name="min" inputMode="numeric" pattern="[0-9]*" defaultValue={cur.min} placeholder="0" /></label>
            <label>Max ₹<input className="sf-input" name="max" inputMode="numeric" pattern="[0-9]*" defaultValue={cur.max} placeholder="Any" /></label>
            <label className="chk"><input type="checkbox" name="stock" value="1" defaultChecked={inStock} /> In stock only</label>
            <span className="acts"><button className="sf-btn">Apply</button><a className="sf-link" href={`${sf.base}/shop/${q({ c: cur.c, q: term })}`}>Clear all</a></span>
          </form>
        </details>
        {catBest.length > 0 && <section className="sf-sec" style={{ paddingTop: 0 }}><h2 style={{ fontSize: 18 }}>Best sellers in {cat!.name}</h2><div className="sf-grid">{catBest.map((p) => <ProductCard key={p.id} p={p} base={sf.base} q={keep ? `?${keep}` : ""} />)}</div></section>}
        {list.length > 0 && <p className="sf-note" style={{ marginTop: -8 }}>{list.length} products{pages > 1 ? ` · page ${pageNo} of ${pages}` : ""}</p>}
        {shown.length ? <div className="sf-grid">{shown.map((p) => <ProductCard key={p.id} p={p} base={sf.base} q={keep ? `?${keep}` : ""} />)}</div> : (
          <div className="sf-empty">
            <p>{term ? `No products match “${term}”.` : filtersOn ? "No products match these filters." : "No products here yet."}</p>
            {(term || filtersOn) && <p className="sf-note">Try fewer words, check the spelling, or <a className="sf-link" href={`${sf.base}/shop/${q({})}`}>see all products</a>.</p>}
            {(term || filtersOn) && bestSellers(sf.products, 4).length > 0 && <div className="sf-grid" style={{ marginTop: 18 }}>{bestSellers(sf.products, 4).map((p) => <ProductCard key={p.id} p={p} base={sf.base} q={keep ? `?${keep}` : ""} />)}</div>}
          </div>
        )}
        {pages > 1 && (
          <nav className="sf-filters" aria-label="Pages" style={{ justifyContent: "center", marginTop: 28 }}>
            {pageNo > 1 && <a className="sf-chip" href={`${sf.base}/shop/${q({ ...cur, page: String(pageNo - 1) })}`} rel="prev">← Previous</a>}
            {Array.from({ length: pages }, (_, i) => i + 1).filter((n) => n === 1 || n === pages || Math.abs(n - pageNo) <= 2).map((n, i, arr) => (
              <span key={n} style={{ display: "contents" }}>
                {i > 0 && n - arr[i - 1] > 1 && <span className="sf-note" aria-hidden>…</span>}
                <a className={`sf-chip${n === pageNo ? " on" : ""}`} aria-current={n === pageNo ? "page" : undefined} href={`${sf.base}/shop/${q({ ...cur, page: n > 1 ? String(n) : "" })}`}>{n}</a>
              </span>
            ))}
            {pageNo < pages && <a className="sf-chip" href={`${sf.base}/shop/${q({ ...cur, page: String(pageNo + 1) })}`} rel="next">Next →</a>}
          </nav>
        )}
      </div>
    </StoreShell>
  );
}
