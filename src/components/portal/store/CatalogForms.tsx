"use client";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ImageUpload, Msg, api, mediaSrc } from "./ui";

type Cat = { id: string; name: string };
export type ProductFormValue = {
  title: string; slug: string; description: string; price: string; compare: string; categoryId: string; images: string[];
  stock: string; weight: string; status: "draft" | "active" | "archived"; featured: boolean; seoTitle: string; seoDescription: string;
};

export function ProductForm({ id, initial, categories, storeSlug }: { id?: string; initial: ProductFormValue; categories: Cat[]; storeSlug: string }) {
  const router = useRouter();
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok?: string; err?: string } | null>(null);
  const set = <K extends keyof ProductFormValue>(k: K, v: ProductFormValue[K]) => setF({ ...f, [k]: v });
  const num = (v: string) => (v.trim() === "" ? NaN : Number(v));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const body = {
      title: f.title, slug: f.slug, description: f.description, priceRupees: num(f.price), compareRupees: f.compare.trim() ? num(f.compare) : null,
      categoryId: f.categoryId || null, images: f.images, stock: Math.floor(num(f.stock) || 0), weightGrams: Math.floor(num(f.weight) || 0),
      status: f.status, featured: f.featured, seoTitle: f.seoTitle, seoDescription: f.seoDescription,
    };
    if (!(body.priceRupees > 0)) { setBusy(false); setMsg({ err: "Enter a price more than 0" }); return; }
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
            <div className="field"><label htmlFor="pp">Price (₹) <span className="req">*</span></label><input id="pp" className="input" inputMode="decimal" value={f.price} onChange={(e) => set("price", e.target.value.replace(/[^0-9.]/g, ""))} required /></div>
            <div className="field"><label htmlFor="pc">Compare-at price (₹)</label><input id="pc" className="input" inputMode="decimal" value={f.compare} onChange={(e) => set("compare", e.target.value.replace(/[^0-9.]/g, ""))} placeholder="MRP, shown struck out" /></div>
            <div className="field"><label htmlFor="ps">Stock</label><input id="ps" className="input" inputMode="numeric" value={f.stock} onChange={(e) => set("stock", e.target.value.replace(/\D/g, ""))} /></div>
            <div className="field"><label htmlFor="pw">Packed weight (grams) <span className="req">*</span></label><input id="pw" className="input" inputMode="numeric" value={f.weight} onChange={(e) => set("weight", e.target.value.replace(/\D/g, ""))} required /></div>
          </div>
          <p className="small muted" style={{ marginTop: 8 }}>Variants (size/colour), HSN/tax and CSV import come in the next update.</p>
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
          <Msg m={msg} />
          <button className="btn btn-orange" style={{ width: "100%", marginTop: 14 }} disabled={busy}>{busy ? "Saving…" : id ? "Save product" : "Add product"}</button>
          {id && f.status !== "archived" && <button type="button" className="btn btn-outline" style={{ width: "100%", marginTop: 8 }} onClick={archive}>Archive</button>}
        </div>
      </div>
      <style>{`@media (max-width:900px){.os-pform{grid-template-columns:1fr!important}}`}</style>
    </form>
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
