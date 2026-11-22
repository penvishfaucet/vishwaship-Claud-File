import { InventoryBoard } from "@/components/portal/store/InventoryBoard";
import { INV_VIEWS, inventoryList, returnsToInspect } from "@/server/store/inventory";
import { requireStorePage } from "@/server/store/portal";
import "@/styles/store.css";

export const metadata = { title: "Inventory — Vishwaship" };
type SP = Promise<{ view?: string; q?: string; page?: string; return?: string }>;
const PER_PAGE = 40;

export default async function Inventory({ searchParams }: { searchParams: SP }) {
  const { ctx } = await requireStorePage();
  const sp = await searchParams;
  const [inv, returns] = await Promise.all([inventoryList(ctx.org.id, sp), returnsToInspect(ctx.org.id, sp.return)]);
  const pages = Math.max(1, Math.ceil(inv.rows.length / PER_PAGE));
  const page = Math.min(pages, Math.max(1, Number(sp.page) || 1));
  const rows = inv.rows.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const link = (over: Record<string, string | number | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, view: inv.view, ...over })) if (v !== undefined && v !== "" && !(k === "page" && Number(v) <= 1)) u.set(k, String(v));
    return `?${u.toString()}`;
  };
  return (
    <>
      <div className="page-h"><div><p className="small muted" style={{ margin: 0 }}><a href="/portal/store/">Online Store</a></p><h1>Inventory</h1>
        <p className="small muted" style={{ margin: "4px 0 0" }}>{inv.totals.units.toLocaleString("en-IN")} pieces on hand · stock value ₹{(inv.totals.valuePaise / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })} at cost{inv.counts.nocost ? ` (${inv.counts.nocost} item(s) without a cost)` : ""}</p></div></div>

      <nav className="so-tabs" aria-label="Which items">
        {INV_VIEWS.map((v) => <a key={v.key} href={link({ view: v.key, page: undefined })} className={`${v.key === inv.view ? "on" : ""}${(v.key === "out" || v.key === "low") && inv.counts[v.key] ? " hot" : ""}`} aria-current={v.key === inv.view ? "page" : undefined}>
          {v.label}<span className="n">{inv.counts[v.key]}</span></a>)}
      </nav>

      <form className="card mb12 row wrap" style={{ padding: 12, gap: 8, alignItems: "flex-end" }} role="search">
        <input type="hidden" name="view" value={inv.view} />
        <div className="field" style={{ flex: 1, minWidth: 180 }}><label htmlFor="q">Search</label><input id="q" name="q" type="search" className="input" defaultValue={sp.q ?? ""} placeholder="SKU or product name" enterKeyHint="search" /></div>
        <button className="btn btn-outline" style={{ minHeight: 42 }}>Search</button>
      </form>

      <InventoryBoard rows={rows} returns={returns} />

      {pages > 1 && (
        <nav className="so-pager" aria-label="Pages">
          {page > 1 ? <a className="btn btn-outline" href={link({ page: page - 1 })}>← Previous</a> : <span />}
          <span className="small muted">Page {page} of {pages}</span>
          {page < pages ? <a className="btn btn-outline" href={link({ page: page + 1 })}>Next →</a> : <span />}
        </nav>
      )}
    </>
  );
}
