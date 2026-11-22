import { readSettings } from "@/lib/store-themes";
import { type DispatchRow, DispatchBoard } from "@/components/portal/store/DispatchBoard";
import { QUEUE_VIEWS, dispatchQueue, istDay } from "@/server/store/dispatch";
import { requireStorePage } from "@/server/store/portal";
import "@/styles/store.css";

export const metadata = { title: "Packing & Dispatch — Vishwaship" };
type SP = Promise<{ view?: string; payment?: string; courier?: string; q?: string }>;

export default async function Dispatch({ searchParams }: { searchParams: SP }) {
  const { ctx, store } = await requireStorePage();
  const sp = await searchParams;
  const q = await dispatchQueue(ctx.org.id, sp);
  const rows: DispatchRow[] = q.rows.map((o) => ({
    id: o.id, number: o.number, stage: o.stage === "ready_to_ship" ? "ready_to_ship" : "to_pack",
    at: (o.acceptedAt ?? o.placedAt ?? o.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }),
    buyer: o.buyer.name, place: `${o.buyer.city} ${o.buyer.pincode}`, items: o.items,
    lines: o.lines.map((l) => `${l.qty} × ${l.sku ? `${l.sku} ` : ""}${l.title}${l.variantTitle ? ` (${l.variantTitle})` : ""}`).join(", "),
    totalPaise: o.totalPaise, cod: o.paymentMethod === "cod", packed: !!o.packedAt, awb: o.awb, carrier: o.carrierName,
    overdue: o.stage === "to_pack" && istDay(o.acceptedAt ?? o.createdAt) < q.today,
  }));
  const link = (over: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, view: q.view, ...over })) if (v) u.set(k, v);
    return `?${u.toString()}`;
  };
  return (
    <>
      <div className="page-h"><div><p className="small muted" style={{ margin: 0 }}><a href="/portal/store/">Online Store</a></p><h1>Packing &amp; Dispatch</h1>
        <p className="small muted" style={{ margin: "4px 0 0" }}>Print packing slips and a pick list, then pack and download all labels at once. Couriers are booked with your Auto-Assign rules (or the cheapest available) from your wallet.</p></div></div>

      <nav className="so-tabs" aria-label="Which orders">
        {QUEUE_VIEWS.map((v) => <a key={v.key} href={link({ view: v.key, courier: v.key === "ready" ? sp.courier : undefined })} className={`${v.key === q.view ? "on" : ""}${v.key === "overdue" && q.counts.overdue ? " hot" : ""}`} aria-current={v.key === q.view ? "page" : undefined}>
          {v.label}<span className="n">{q.counts[v.key]}</span></a>)}
      </nav>

      <form className="card mb12 row wrap" style={{ padding: 12, gap: 8, alignItems: "flex-end" }} role="search">
        <input type="hidden" name="view" value={q.view} />
        <div className="field" style={{ flex: 1, minWidth: 160 }}><label htmlFor="q">Search</label><input id="q" name="q" type="search" className="input" defaultValue={sp.q ?? ""} placeholder="Order no, name, mobile" enterKeyHint="search" /></div>
        <div className="field"><label htmlFor="pay">Payment</label><select id="pay" name="payment" className="input select" defaultValue={sp.payment ?? ""}><option value="">All</option><option value="cod">COD</option><option value="prepaid">Prepaid</option></select></div>
        {q.couriers.length > 0 && <div className="field"><label htmlFor="cr">Courier</label><select id="cr" name="courier" className="input select" defaultValue={sp.courier ?? ""}><option value="">All</option>{q.couriers.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>}
        <button className="btn btn-outline" style={{ minHeight: 42 }}>Apply</button>
      </form>

      <DispatchBoard rows={rows} view={q.view} warehouseId={readSettings(store.settings).checkout.warehouseId} today={q.today} />
    </>
  );
}
