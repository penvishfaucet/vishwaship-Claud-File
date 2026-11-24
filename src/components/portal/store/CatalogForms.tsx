"use client";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ImageUpload, Msg, api, mediaSrc } from "./ui";

type Cat = { id: string; name: string };
export type ProductFormValue = {
  title: string; slug: string; description: string; price: string; compare: string; categoryId: string; images: string[];
  stock: string; weight: string; status: "draft" | "active" | "archived"; featured: boolean; seoTitle: string; seoDescription: string;
  sku: string; hsn: string; taxPercent: string; lowStockAt: string; lengthCm: string; breadthCm: string; heightCm: string;
  options: string[]; variants: VariantRow[];
  /** cost per piece in rupees (text inputs); product = purchase cost */
  costs?: { product: string; packaging: string; labour: string; other: string; overhead: string };
  /** "Frequently bought together" add-on product ids */
  addonIds?: string[];
  /** Filterable attributes (Finish, Material, Size…) and product page details */
  attributes?: Array<{ name: string; value: string }>;
  details?: { highlights: string; specs: Array<{ label: string; value: string }>; usage: string; inBox: string; care: string; warranty: string };
};
const NO_DETAILS = { highlights: "", specs: [] as Array<{ label: string; value: string }>, usage: "", inBox: "", care: "", warranty: "" };
const ATTR_SUGGEST = ["Brand", "Finish", "Material", "Size", "Colour", "Shape", "Surface type", "Pack size", "Fragrance", "Fabric", "Fit", "Capacity", "Power", "Warranty"];
export type CatalogItem = { id: string; title: string; sku: string | null; status: string };
const NO_COSTS = { product: "", packaging: "", labour: "", other: "", overhead: "" };
export type VariantRow = { id: string | null; values: string[]; sku: string; price: string; compare: string; stock: string; weight: string; image?: string | null };

const GST = ["0", "0.25", "3", "5", "12", "18", "28"];

/** Every combination of the option values (e.g. Size S,M × Colour Red,Blue → 4 variants). */
function combos(lists: string[][]): string[][] {
  return lists.reduce<string[][]>((acc, vals) => acc.flatMap((a) => vals.map((v) => [...a, v])), [[]]).filter((c) => c.length === lists.length);
}

export function ProductForm({ id, initial, categories, storeSlug, catalog = [] }: { id?: string; initial: ProductFormValue; categories: Cat[]; storeSlug: string; catalog?: CatalogItem[] }) {
  const router = useRouter();
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; err?: string } | null>(null);
  const [optValues, setOptValues] = useState<string[]>(initial.options.map((_, i) => [...new Set(initial.variants.map((v) => v.values[i]))].join(", ")));
  const set = <K extends keyof ProductFormValue>(k: K, v: ProductFormValue[K]) => setF({ ...f, [k]: v });
  const num = (v: string) => (v.trim() === "" ? NaN : Number(v));
  const hasVariants = f.options.length > 0;
  const cs = f.costs ?? NO_COSTS;
  const setCost = (k: keyof typeof NO_COSTS, v: string) => setF({ ...f, costs: { ...cs, [k]: v.replace(/[^0-9.]/g, "") } });
  const costTotal = (hasVariants ? 0 : Number(cs.product) || 0) + (Number(cs.packaging) || 0) + (Number(cs.labour) || 0) + (Number(cs.other) || 0) + (Number(cs.overhead) || 0);
  const priceNow = hasVariants ? Math.min(...f.variants.map((v) => Number(v.price) || Infinity)) : Number(f.price) || 0;

  function buildVariants(options: string[], valueText: string[]) {
    const lists = options.map((_, i) => [...new Set((valueText[i] ?? "").split(",").map((s) => s.trim()).filter(Boolean))].slice(0, 20));
    if (lists.some((l) => !l.length)) return;
    const next = combos(lists).slice(0, 100).map((values) => {
      const old = f.variants.find((v) => v.values.join("|").toLowerCase() === values.join("|").toLowerCase());
      return old ?? { id: null, values, sku: "", price: f.price, compare: f.compare, stock: "0", weight: "" };
    });
    setF((cur) => ({ ...cur, options, variants: next }));
  }
  const setVar = (i: number, k: keyof VariantRow, v: string) => setF({ ...f, variants: f.variants.map((x, j) => (j === i ? { ...x, [k]: v } : x)) });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const variants = f.variants.map((v) => ({ id: v.id, values: v.values, sku: v.sku, priceRupees: num(v.price), compareRupees: v.compare.trim() ? num(v.compare) : null, stock: Math.floor(num(v.stock) || 0), weightGrams: v.weight.trim() ? Math.floor(num(v.weight)) : null, image: v.image && f.images.includes(v.image) ? v.image : null }));
    const body = {
      title: f.title, slug: f.slug, description: f.description,
      priceRupees: hasVariants ? Math.min(...variants.map((v) => v.priceRupees).filter((x) => x > 0), Infinity) : num(f.price),
      compareRupees: !hasVariants && f.compare.trim() ? num(f.compare) : null,
      categoryId: f.categoryId || null, images: f.images, stock: Math.floor(num(f.stock) || 0), weightGrams: Math.floor(num(f.weight) || 0),
      status: f.status, featured: f.featured, seoTitle: f.seoTitle, seoDescription: f.seoDescription,
      sku: f.sku, hsn: f.hsn, taxPercent: Number(f.taxPercent) || 0, lowStockAt: Math.floor(num(f.lowStockAt) || 0),
      lengthCm: num(f.lengthCm) || 0, breadthCm: num(f.breadthCm) || 0, heightCm: num(f.heightCm) || 0,
      options: f.options, variants: hasVariants ? variants : [],
      addonIds: f.addonIds ?? [],
      attributes: (f.attributes ?? []).map((a) => ({ name: a.name.trim(), value: a.value.trim() })).filter((a) => a.name && a.value),
      details: { ...(f.details ?? NO_DETAILS), specs: (f.details?.specs ?? []).map((x) => ({ label: x.label.trim(), value: x.value.trim() })).filter((x) => x.label && x.value) },
      costs: { productRupees: !hasVariants && cs.product.trim() ? Number(cs.product) || 0 : null, packagingRupees: Number(cs.packaging) || 0, labourRupees: Number(cs.labour) || 0, otherRupees: Number(cs.other) || 0, overheadRupees: Number(cs.overhead) || 0 },
    };
    if (hasVariants && variants.some((v) => !(v.priceRupees > 0))) { setBusy(false); setMsg({ err: "Enter a price for every variant" }); return; }
    if (!(body.priceRupees > 0) || !Number.isFinite(body.priceRupees)) { setBusy(false); setMsg({ err: "Enter a price more than 0" }); return; }
    if (!(body.weightGrams > 0)) { setBusy(false); setMsg({ err: "Enter the packed weight in grams" }); return; }
    const r = await api<{ id: string; slug: string }>(id ? "PUT" : "POST", id ? `/api/portal/store/products/${id}` : "/api/portal/store/products", body);
    setBusy(false);
    if (!r.ok) { setMsg({ err: r.error }); return; }
    router.push("/portal/store/products/?saved=1"); router.refresh();
  }

  async function archive() {
    if (!id || !confirm("Archive this product? It disappears from your store but stays in past orders.")) return;
    const r = await api("DELETE", `/api/portal/store/products/${id}`);
    if (!r.ok) { setMsg({ err: r.error }); return; }
    router.push("/portal/store/products/"); router.refresh();
  }

  return (
    <form onSubmit={submit} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 300px", gap: 16, alignItems: "start" }} className="os-pform">
      <div>
        <div className="card mb12" style={{ padding: 20 }}>
          <div className="field"><label htmlFor="pt">Product name <span className="req">*</span></label><input id="pt" className="input" maxLength={140} value={f.title} onChange={(e) => set("title", e.target.value)} required /></div>
          <div className="field" style={{ marginTop: 12 }}><label htmlFor="pd">Description</label><textarea id="pd" className="input" rows={6} maxLength={5000} value={f.description} onChange={(e) => set("description", e.target.value)} /></div>
        </div>
        <DetailsCard value={f} onChange={(patch) => setF((cur) => ({ ...cur, ...patch }))} />
        <div className="card mb12" style={{ padding: 20 }}>
          <h3 style={{ marginBottom: 8 }}>Photos</h3>
          <div className="os-thumbs">
            {f.images.map((m, i) => (
              <div className="t" key={m}><img src={mediaSrc(m)} alt={`Photo ${i + 1}`} /><button type="button" onClick={() => set("images", f.images.filter((x) => x !== m))} aria-label={`Remove photo ${i + 1}`}>✕</button></div>
            ))}
          </div>
          <div style={{ marginTop: 10 }}>{f.images.length < 8 && <ImageUpload label="Add photo" onDone={(mid) => setF((cur) => ({ ...cur, images: [...cur.images, mid] }))} />}</div>
          <p className="small muted" style={{ marginTop: 6 }}>Up to 8 photos. The first one is the main photo. Square images look best.</p>
        </div>
        <div className="card mb12" style={{ padding: 20 }}>
          <h3 style={{ marginBottom: 8 }}>Price & stock</h3>
          <div className="grid2">
            {!hasVariants && <>
              <div className="field"><label htmlFor="pp">Price (₹) <span className="req">*</span></label><input id="pp" className="input" inputMode="decimal" value={f.price} onChange={(e) => set("price", e.target.value.replace(/[^0-9.]/g, ""))} required /></div>
              <div className="field"><label htmlFor="pc">Compare-at price (₹)</label><input id="pc" className="input" inputMode="decimal" value={f.compare} onChange={(e) => set("compare", e.target.value.replace(/[^0-9.]/g, ""))} placeholder="MRP, shown struck out" /></div>
              <div className="field"><label htmlFor="ps">Stock</label><input id="ps" className="input" inputMode="numeric" value={f.stock} onChange={(e) => set("stock", e.target.value.replace(/\D/g, ""))} /></div>
              <div className="field"><label htmlFor="psku">SKU</label><input id="psku" className="input" maxLength={60} value={f.sku} onChange={(e) => set("sku", e.target.value)} /></div>
            </>}
            <div className="field"><label htmlFor="pw">Packed weight (grams) <span className="req">*</span></label><input id="pw" className="input" inputMode="numeric" value={f.weight} onChange={(e) => set("weight", e.target.value.replace(/\D/g, ""))} required /></div>
            <div className="field"><label htmlFor="plow">Low-stock alert at</label><input id="plow" className="input" inputMode="numeric" value={f.lowStockAt} onChange={(e) => set("lowStockAt", e.target.value.replace(/\D/g, ""))} /></div>
          </div>
        </div>
        <div className="card mb12" style={{ padding: 20 }}>
          <h3 style={{ marginBottom: 4 }}>Cost per piece</h3>
          <p className="small muted" style={{ marginTop: 0 }}>Used for each order&apos;s profit &amp; loss. Packaging and the other costs are added to every piece sold. Update many products at once from Inventory → Export / Import CSV.</p>
          <div className="grid2">
            {!hasVariants && <div className="field"><label htmlFor="cp">Product / purchase cost (₹)</label><input id="cp" className="input" inputMode="decimal" value={cs.product} onChange={(e) => setCost("product", e.target.value)} placeholder="What one piece costs you" /></div>}
            <div className="field"><label htmlFor="cpk">Packaging (₹)</label><input id="cpk" className="input" inputMode="decimal" value={cs.packaging} onChange={(e) => setCost("packaging", e.target.value)} placeholder="Box, tape, bubble wrap" /></div>
            <div className="field"><label htmlFor="clb">Labour / handling (₹)</label><input id="clb" className="input" inputMode="decimal" value={cs.labour} onChange={(e) => setCost("labour", e.target.value)} placeholder="Packing, quality check" /></div>
            <div className="field"><label htmlFor="cot">Other variable cost (₹)</label><input id="cot" className="input" inputMode="decimal" value={cs.other} onChange={(e) => setCost("other", e.target.value)} placeholder="Freebie, printing" /></div>
            <div className="field"><label htmlFor="cov">Overheads per piece (₹)</label><input id="cov" className="input" inputMode="decimal" value={cs.overhead} onChange={(e) => setCost("overhead", e.target.value)} placeholder="Share of rent, salaries" /></div>
          </div>
          {hasVariants && <p className="tiny muted" style={{ margin: "4px 0 0" }}>With variants, each variant&apos;s purchase cost is set in Inventory; the costs above are added to every variant.</p>}
          <p className="small" style={{ margin: "8px 0 0" }}><b>Total cost per piece: ₹{costTotal.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</b>
            {priceNow > 0 && Number.isFinite(priceNow) && costTotal > 0 && <span className={priceNow - costTotal < 0 ? "red" : "muted"}> · margin before shipping &amp; GST ₹{(priceNow - costTotal).toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>}</p>
        </div>
        <div className="card mb12" style={{ padding: 20 }}>
          <h3 style={{ marginBottom: 4 }}>Variants</h3>
          <p className="small muted" style={{ marginTop: 0 }}>Sizes, colours or other options. Each variant has its own price and stock.</p>
          {f.options.map((o, i) => (
            <div className="grid2" key={i} style={{ marginBottom: 8 }}>
              <div className="field"><label htmlFor={`on${i}`}>Option name</label><input id={`on${i}`} className="input" value={o} maxLength={30} onChange={(e) => setF({ ...f, options: f.options.map((x, j) => (j === i ? e.target.value : x)) })} placeholder="Size" /></div>
              <div className="field"><label htmlFor={`ov${i}`}>Values (comma separated)</label>
                <div className="row" style={{ gap: 6 }}>
                  <input id={`ov${i}`} className="input" style={{ flex: 1, minWidth: 0 }} value={optValues[i] ?? ""} onChange={(e) => setOptValues(optValues.map((x, j) => (j === i ? e.target.value : x)))} onBlur={() => buildVariants(f.options, optValues)} placeholder="S, M, L, XL" />
                  <button type="button" className="os-ic" aria-label={`Remove option ${o || i + 1}`} onClick={() => { const options = f.options.filter((_, j) => j !== i); const vals = optValues.filter((_, j) => j !== i); setOptValues(vals); if (!options.length) setF({ ...f, options: [], variants: [] }); else buildVariants(options, vals); }}><Trash2 size={14} /></button>
                </div></div>
            </div>
          ))}
          {f.options.length < 3 && <button type="button" className="btn btn-outline btn-sm" onClick={() => { setF({ ...f, options: [...f.options, f.options.length ? "Colour" : "Size"] }); setOptValues([...optValues, ""]); }}>+ Add option</button>}
          {hasVariants && f.variants.length > 0 && (
            <div style={{ overflowX: "auto", marginTop: 12 }}>
              <table className="os-dns">
                <thead><tr><th>Variant</th><th>Price ₹</th><th>MRP ₹</th><th>Stock</th><th>SKU</th><th>Weight g</th>{f.images.length > 1 && <th>Photo</th>}</tr></thead>
                <tbody>{f.variants.map((v, i) => (
                  <tr key={v.values.join("|")}>
                    <td><b>{v.values.join(" / ")}</b></td>
                    <td><input className="input" style={{ width: 90 }} inputMode="decimal" aria-label={`Price for ${v.values.join(" / ")}`} value={v.price} onChange={(e) => setVar(i, "price", e.target.value.replace(/[^0-9.]/g, ""))} /></td>
                    <td><input className="input" style={{ width: 90 }} inputMode="decimal" aria-label={`MRP for ${v.values.join(" / ")}`} value={v.compare} onChange={(e) => setVar(i, "compare", e.target.value.replace(/[^0-9.]/g, ""))} /></td>
                    <td><input className="input" style={{ width: 70 }} inputMode="numeric" aria-label={`Stock for ${v.values.join(" / ")}`} value={v.stock} onChange={(e) => setVar(i, "stock", e.target.value.replace(/\D/g, ""))} /></td>
                    <td><input className="input" style={{ width: 110 }} aria-label={`SKU for ${v.values.join(" / ")}`} value={v.sku} maxLength={60} onChange={(e) => setVar(i, "sku", e.target.value)} /></td>
                    <td><input className="input" style={{ width: 80 }} inputMode="numeric" aria-label={`Weight for ${v.values.join(" / ")}`} placeholder={f.weight} value={v.weight} onChange={(e) => setVar(i, "weight", e.target.value.replace(/\D/g, ""))} /></td>
                    {f.images.length > 1 && <td><select className="input select" style={{ width: 110 }} aria-label={`Photo for ${v.values.join(" / ")}`} value={v.image ?? ""} onChange={(e) => setF({ ...f, variants: f.variants.map((x, j) => (j === i ? { ...x, image: e.target.value || null } : x)) })}>
                      <option value="">Main photo</option>{f.images.map((m, k) => <option key={m} value={m}>Photo {k + 1}</option>)}</select></td>}
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {hasVariants && !f.variants.length && <p className="small muted">Type the values and click outside the box to create the variants.</p>}
        </div>
        <div className="card mb12" style={{ padding: 20 }}>
          <h3 style={{ marginBottom: 8 }}>Tax & box size</h3>
          <div className="grid3">
            <div className="field"><label htmlFor="phsn">HSN code</label><input id="phsn" className="input" inputMode="numeric" maxLength={8} value={f.hsn} onChange={(e) => set("hsn", e.target.value.replace(/\D/g, ""))} /></div>
            <div className="field"><label htmlFor="pgst">GST rate</label><select id="pgst" className="input select" value={f.taxPercent} onChange={(e) => set("taxPercent", e.target.value)}>{GST.map((g) => <option key={g} value={g}>{g}%</option>)}</select></div>
            <div />
            <div className="field"><label htmlFor="pl">Length (cm)</label><input id="pl" className="input" inputMode="decimal" value={f.lengthCm} onChange={(e) => set("lengthCm", e.target.value.replace(/[^0-9.]/g, ""))} /></div>
            <div className="field"><label htmlFor="pb">Breadth (cm)</label><input id="pb" className="input" inputMode="decimal" value={f.breadthCm} onChange={(e) => set("breadthCm", e.target.value.replace(/[^0-9.]/g, ""))} /></div>
            <div className="field"><label htmlFor="ph">Height (cm)</label><input id="ph" className="input" inputMode="decimal" value={f.heightCm} onChange={(e) => set("heightCm", e.target.value.replace(/[^0-9.]/g, ""))} /></div>
          </div>
          <p className="small muted" style={{ marginTop: 8 }}>Prices include GST. Box size and weight are used for exact courier rates when you ship.</p>
        </div>
        <div className="card mb12" style={{ padding: 20 }}>
          <h3 style={{ marginBottom: 8 }}>Search engines (optional)</h3>
          <div className="field"><label htmlFor="sl">Page link</label><div className="small muted" style={{ marginBottom: 4 }}>/s/{storeSlug}/products/<b>{f.slug || "auto-from-name"}</b>/</div><input id="sl" className="input" maxLength={80} value={f.slug} onChange={(e) => set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} placeholder="Leave empty to create from the name" /></div>
          <div className="field" style={{ marginTop: 10 }}><label htmlFor="sti">SEO title</label><input id="sti" className="input" maxLength={70} value={f.seoTitle} onChange={(e) => set("seoTitle", e.target.value)} /></div>
          <div className="field" style={{ marginTop: 10 }}><label htmlFor="sde">SEO description</label><textarea id="sde" className="input" rows={2} maxLength={160} value={f.seoDescription} onChange={(e) => set("seoDescription", e.target.value)} /></div>
        </div>
      </div>
      <div className="sticky-side">
        <div className="card mb12" style={{ padding: 16 }}>
          <div className="field"><label htmlFor="pst">Status</label>
            <select id="pst" className="input select" value={f.status} onChange={(e) => set("status", e.target.value as ProductFormValue["status"])}><option value="active">Active (visible)</option><option value="draft">Draft (hidden)</option>{id && <option value="archived">Archived</option>}</select></div>
          <div className="field" style={{ marginTop: 10 }}><label htmlFor="pca">Category</label>
            <select id="pca" className="input select" value={f.categoryId} onChange={(e) => set("categoryId", e.target.value)}><option value="">No category</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <label className="row" style={{ gap: 8, marginTop: 12, fontWeight: 500 }}><input type="checkbox" checked={f.featured} onChange={(e) => set("featured", e.target.checked)} /> Show in Featured products</label>
          {catalog.length > 0 && <AddonPicker catalog={catalog.filter((c) => c.id !== id)} value={f.addonIds ?? []} onChange={(v) => set("addonIds", v)} />}
          <Msg m={msg} />
          <button className="btn btn-orange" style={{ width: "100%", marginTop: 14 }} disabled={busy}>{busy ? "Saving…" : id ? "Save product" : "Add product"}</button>
          {id && f.status !== "archived" && <button type="button" className="btn btn-outline" style={{ width: "100%", marginTop: 8 }} onClick={archive}>Archive</button>}
        </div>
      </div>
      <style>{`@media (max-width:900px){.os-pform{grid-template-columns:1fr!important}}`}</style>
    </form>
  );
}

/** Filters (attributes) + product page sections. Empty fields are not shown to buyers. */
function DetailsCard({ value, onChange }: { value: ProductFormValue; onChange: (p: Partial<ProductFormValue>) => void }) {
  const attrs = value.attributes ?? [];
  const d = value.details ?? NO_DETAILS;
  const setD = (p: Partial<typeof d>) => onChange({ details: { ...d, ...p } });
  const area = (k: "highlights" | "usage" | "inBox" | "care" | "warranty", label: string, hint: string, rows = 3) => (
    <div className="field" style={{ marginTop: 10 }}><label htmlFor={`pdx-${k}`}>{label}</label>
      <textarea id={`pdx-${k}`} className="input" rows={rows} maxLength={k === "usage" ? 3000 : k === "care" ? 2000 : 1000} value={d[k]} onChange={(e) => setD({ [k]: e.target.value })} placeholder={hint} /></div>
  );
  return (
    <div className="card mb12" style={{ padding: 20 }}>
      <h3 style={{ marginBottom: 4 }}>Details &amp; filters</h3>
      <p className="small muted" style={{ margin: "0 0 10px" }}>Attributes become shop filters for this category (e.g. Finish, Material, Size for taps; Surface, Pack size for cleaners) and show under Specifications.</p>
      <datalist id="attr-names">{ATTR_SUGGEST.map((x) => <option key={x} value={x} />)}</datalist>
      {attrs.map((a, i) => (
        <div key={i} className="row" style={{ gap: 6, marginBottom: 6 }}>
          <input className="input" list="attr-names" placeholder="Name (e.g. Finish)" aria-label={`Attribute ${i + 1} name`} maxLength={30} value={a.name} onChange={(e) => onChange({ attributes: attrs.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
          <input className="input" placeholder="Value (e.g. Chrome)" aria-label={`Attribute ${i + 1} value`} maxLength={60} value={a.value} onChange={(e) => onChange({ attributes: attrs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })} />
          <button type="button" className="icon-btn" aria-label={`Remove attribute ${i + 1}`} onClick={() => onChange({ attributes: attrs.filter((_, j) => j !== i) })}><Trash2 size={16} /></button>
        </div>
      ))}
      {attrs.length < 12 && <button type="button" className="btn btn-outline btn-sm" onClick={() => onChange({ attributes: [...attrs, { name: "", value: "" }] })}>+ Add attribute</button>}
      {area("highlights", "Key benefits (one per line)", "Rust-proof brass body\nCeramic disc cartridge — drip free", 3)}
      <div className="field" style={{ marginTop: 10 }}><label>Specifications</label>
        {d.specs.map((x, i) => (
          <div key={i} className="row" style={{ gap: 6, marginBottom: 6 }}>
            <input className="input" placeholder="e.g. Body" aria-label={`Specification ${i + 1} label`} maxLength={40} value={x.label} onChange={(e) => setD({ specs: d.specs.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)) })} />
            <input className="input" placeholder="e.g. Brass, 1.2 kg" aria-label={`Specification ${i + 1} value`} maxLength={200} value={x.value} onChange={(e) => setD({ specs: d.specs.map((y, j) => (j === i ? { ...y, value: e.target.value } : y)) })} />
            <button type="button" className="icon-btn" aria-label={`Remove specification ${i + 1}`} onClick={() => setD({ specs: d.specs.filter((_, j) => j !== i) })}><Trash2 size={16} /></button>
          </div>
        ))}
        {d.specs.length < 20 && <button type="button" className="btn btn-outline btn-sm" onClick={() => setD({ specs: [...d.specs, { label: "", value: "" }] })}>+ Add specification</button>}
      </div>
      {area("usage", "How to use / installation", "Steps or tips for using the product")}
      {area("inBox", "What's in the box", "1 tap, 2 wall flanges, Teflon tape", 2)}
      {area("care", "Care", "Wipe with a soft dry cloth; no acid cleaners", 2)}
      {area("warranty", "Warranty", "5-year warranty against manufacturing defects", 2)}
    </div>
  );
}

/** Pick up to 6 compatible add-ons (e.g. Overhead shower → Shower arm). Shown with the buy buttons and in the cart. */
function AddonPicker({ catalog, value, onChange }: { catalog: CatalogItem[]; value: string[]; onChange: (v: string[]) => void }) {
  const [q, setQ] = useState("");
  const byId = new Map(catalog.map((c) => [c.id, c]));
  const term = q.trim().toLowerCase();
  const hits = term ? catalog.filter((c) => !value.includes(c.id) && `${c.title} ${c.sku ?? ""}`.toLowerCase().includes(term)).slice(0, 8) : [];
  return (
    <div className="field" style={{ marginTop: 14 }}>
      <label htmlFor="paddon">Frequently bought together</label>
      <p className="tiny muted" style={{ margin: "0 0 6px" }}>Compatible add-ons shown next to Buy and in the cart (max 6). Example: shower arm for an overhead shower.</p>
      {value.length > 0 && <div className="row wrap" style={{ gap: 6, marginBottom: 6 }}>{value.map((id) => {
        const c = byId.get(id);
        return <span key={id} className="chip c-draft" style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>{c ? c.title : "Removed product"}{c && c.status !== "active" ? " (hidden)" : ""}<button type="button" className="link" aria-label={`Remove ${c?.title ?? "add-on"}`} onClick={() => onChange(value.filter((x) => x !== id))}>×</button></span>;
      })}</div>}
      {value.length < 6 && <input id="paddon" className="input" placeholder="Search product name or SKU" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />}
      {hits.length > 0 && <ul className="plain-list" style={{ border: "1px solid var(--line, #e5e7eb)", borderRadius: 8, marginTop: 4, maxHeight: 220, overflow: "auto" }}>{hits.map((c) => (
        <li key={c.id}><button type="button" className="link" style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 10px" }} onClick={() => { onChange([...value, c.id]); setQ(""); }}>{c.title}{c.sku ? <span className="tiny muted"> · {c.sku}</span> : null}{c.status !== "active" ? <span className="tiny muted"> · {c.status}</span> : null}</button></li>
      ))}</ul>}
    </div>
  );
}

export function CategoryManager({ categories }: { categories: Array<Cat & { count: number }> }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<{ ok?: string; err?: string } | null>(null);
  async function add(e: React.FormEvent) {
    e.preventDefault();
    const r = await api("POST", "/api/portal/store/categories", { name });
    if (!r.ok) { setMsg({ err: r.error }); return; }
    setName(""); setMsg(null); router.refresh();
  }
  async function del(c: Cat) {
    if (!confirm(`Delete category "${c.name}"? Its products stay, without a category.`)) return;
    const r = await api("DELETE", `/api/portal/store/categories?id=${encodeURIComponent(c.id)}`);
    if (!r.ok) setMsg({ err: r.error }); else router.refresh();
  }
  return (
    <div className="card" style={{ padding: 16 }}>
      <h3 style={{ fontSize: 14, marginBottom: 8 }}>Categories</h3>
      <ul style={{ listStyle: "none", padding: 0, margin: "0 0 10px", display: "grid", gap: 4 }}>
        {categories.map((c) => <li key={c.id} className="row between" style={{ alignItems: "center" }}><span>{c.name} <span className="tiny muted">({c.count})</span></span><button className="os-ic" onClick={() => del(c)} aria-label={`Delete ${c.name}`}><Trash2 size={14} /></button></li>)}
        {!categories.length && <li className="small muted">No categories yet.</li>}
      </ul>
      <form className="row" style={{ gap: 6 }} onSubmit={add}>
        <label htmlFor="newcat" className="sr-only">New category</label>
        <input id="newcat" className="input" placeholder="New category" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
        <button className="btn btn-outline btn-sm" disabled={name.trim().length < 2}>Add</button>
      </form>
      <Msg m={msg} />
    </div>
  );
}
