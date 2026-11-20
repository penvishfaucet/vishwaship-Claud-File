import { Plus } from "lucide-react";
import { CategoryManager } from "@/components/portal/store/CatalogForms";
import { CsvImport } from "@/components/portal/store/StoreOps";
import { rupees } from "@/lib/store-themes";
import { listCategories, listProducts } from "@/server/store/catalog";
import { requireStorePage } from "@/server/store/portal";
import "@/styles/store.css";

export const metadata = { title: "Store products — Vishwaship" };
type SP = Promise<{ q?: string; status?: string; c?: string; saved?: string }>;

export default async function StoreProducts({ searchParams }: { searchParams: SP }) {
  const { ctx } = await requireStorePage();
  const sp = await searchParams;
  const [cats, all] = await Promise.all([listCategories(ctx.org.id), listProducts(ctx.org.id)]);
  const list = await listProducts(ctx.org.id, { q: sp.q?.slice(0, 60), status: sp.status, categoryId: sp.c });
  const catName = new Map(cats.map((c) => [c.id, c.name]));
  const counts = cats.map((c) => ({ id: c.id, name: c.name, count: all.filter((p) => p.categoryId === c.id && p.status !== "archived").length }));
  const tabs = [["", "All"], ["active", "Active"], ["draft", "Draft"], ["archived", "Archived"]] as const;
  return (
    <>
      <div className="page-h">
        <div><p className="small muted" style={{ margin: 0 }}><a href="/portal/store/">Online Store</a></p><h1>Store products</h1></div>
        <a className="btn btn-orange" href="/portal/store/products/new/"><Plus size={14} aria-hidden /> Add product</a>
      </div>
      {sp.saved && <div className="small mb12" role="status" style={{ background: "var(--green-soft)", color: "var(--green)", borderRadius: 10, padding: "10px 12px" }}>Product saved.</div>}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 280px", gap: 16, alignItems: "start" }} className="os-plist">
        <div className="card">
          <div className="row between wrap" style={{ gap: 8, padding: 12, borderBottom: "1px solid var(--line-2)" }}>
            <nav className="tabs" aria-label="Status">{tabs.map(([k, l]) => <a key={k} className={(sp.status ?? "") === k ? "on" : ""} href={`?status=${k}${sp.q ? `&q=${encodeURIComponent(sp.q)}` : ""}`}>{l}<span className="n">{k ? all.filter((p) => p.status === k).length : all.length}</span></a>)}</nav>
            <form className="row" style={{ gap: 6 }} role="search">
              {sp.status && <input type="hidden" name="status" value={sp.status} />}
              <label htmlFor="pq" className="sr-only">Search products</label>
              <input id="pq" name="q" className="input" placeholder="Search products" defaultValue={sp.q ?? ""} style={{ width: 200 }} />
              <select name="c" className="input select" defaultValue={sp.c ?? ""} aria-label="Category"><option value="">All categories</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
              <button className="btn btn-outline btn-sm">Filter</button>
            </form>
          </div>
          {list.length ? (
            <div style={{ overflowX: "auto" }}>
              <table className="os-dns">
                <thead><tr><th style={{ width: 56 }}></th><th>Product</th><th>Price</th><th>Stock</th><th>Category</th><th>Status</th></tr></thead>
                <tbody>{list.map((p) => {
                  const img = (p.images as string[])[0];
                  return (
                    <tr key={p.id}>
                      <td>{img ? <img src={`/api/store-media/${img}/`} alt="" style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 8 }} /> : <span style={{ display: "block", width: 44, height: 44, borderRadius: 8, background: "var(--gray-soft)" }} />}</td>
                      <td><a className="orange" style={{ fontWeight: 600 }} href={`/portal/store/products/${p.id}/`}>{p.title}</a>{p.featured && <span className="tiny muted"> · featured</span>}</td>
                      <td>{rupees(p.pricePaise)}</td>
                      <td className={p.stock <= p.lowStockAt ? "red" : ""}>{p.stock}{p.stock > 0 && p.stock <= p.lowStockAt && <div className="tiny">Low stock</div>}</td>
                      <td>{p.categoryId ? catName.get(p.categoryId) ?? "—" : "—"}</td>
                      <td><span className={`chip ${p.status === "active" ? "c-active" : p.status === "archived" ? "c-cancelled" : "c-draft"}`}>{p.status}</span></td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          ) : <p className="muted" style={{ padding: 24, textAlign: "center" }}>{all.length ? "No products match." : "No products yet. Add your first product."}</p>}
        </div>
        <div style={{ display: "grid", gap: 12 }}><CategoryManager categories={counts} /><CsvImport /></div>
      </div>
      <style>{`@media (max-width:900px){.os-plist{grid-template-columns:1fr!important}}`}</style>
    </>
  );
}
