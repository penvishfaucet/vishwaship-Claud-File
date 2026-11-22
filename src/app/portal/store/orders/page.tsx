import { rupees } from "@/lib/store-themes";
import { readSettings } from "@/lib/store-themes";
import { type BoardRow, OrdersBoard } from "@/components/portal/store/OrdersBoard";
import { PAYMENT_LABEL, STAGE_LABEL, TABS, listStoreOrders, tabCounts } from "@/server/store/orders";
import { REFUND_LABEL } from "@/server/store/refunds";
import { requireStorePage } from "@/server/store/portal";
import "@/styles/store.css";

export const metadata = { title: "Store orders — Vishwaship" };
type SP = Promise<{ q?: string; payment?: string; method?: string; from?: string; to?: string; tab?: string; page?: string }>;
const PER_PAGE = 30;

export default async function StoreOrders({ searchParams }: { searchParams: SP }) {
  const { ctx, store } = await requireStorePage();
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === sp.tab)?.key ?? "pending";
  const [all, counts] = await Promise.all([listStoreOrders(ctx.org.id, { ...sp, tab }), tabCounts(ctx.org.id)]);
  const page = Math.max(1, Math.min(Number(sp.page) || 1, Math.ceil(all.length / PER_PAGE) || 1));
  const rows = all.slice((page - 1) * PER_PAGE, page * PER_PAGE);
  const hours = readSettings(store?.settings).checkout.acceptWithinHours;
  const now = Date.now();
  const board: BoardRow[] = rows.map((o) => ({
    id: o.id, number: o.number, createdAt: (o.placedAt ?? o.createdAt).toISOString(), stage: o.stage, stageLabel: STAGE_LABEL[o.stage], buyer: o.buyer.name,
    place: `${o.buyer.city} ${o.buyer.pincode}`, items: o.items, totalPaise: o.totalPaise, method: o.paymentMethod === "cod" ? "cod" : "prepaid",
    payLabel: PAYMENT_LABEL[o.paymentStatus] ?? o.paymentStatus, payTone: ["paid", "refunded", "cod_pending"].includes(o.paymentStatus) ? "ok" : ["failed", "refund_due"].includes(o.paymentStatus) ? "bad" : "warn",
    overdue: o.stage === "pending_acceptance" && now - (o.placedAt ?? o.createdAt).getTime() > hours * 3_600_000, awb: o.awb, refundLabel: o.refund ? REFUND_LABEL[o.refund.status] : null,
  }));
  const qs = (over: Record<string, string | number | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, tab, ...over })) if (v !== undefined && v !== "" && !(k === "page" && Number(v) <= 1)) u.set(k, String(v));
    return `?${u.toString()}`;
  };
  const total = all.filter((r) => r.status !== "cancelled").reduce((s, r) => s + r.totalPaise, 0);
  const filtered = !!(sp.q || sp.payment || sp.method || sp.from || sp.to);
  return (
    <>
      <div className="page-h"><div><p className="small muted" style={{ margin: 0 }}><a href="/portal/store/">Online Store</a></p><h1>Store orders</h1>
        <p className="small muted" style={{ margin: "4px 0 0" }}>Accept or reject new orders, then pack and ship them. Courier booking, labels and tracking use your Vishwaship account.</p></div></div>

      <nav className="so-tabs" aria-label="Order status">
        {TABS.map((t) => <a key={t.key} href={`?tab=${t.key}`} className={`${t.key === tab ? "on" : ""}${t.key === "pending" && counts.pending ? " hot" : ""}`} aria-current={t.key === tab ? "page" : undefined}>
          {t.label}{t.key !== "all" && <span className="n">{counts[t.key] ?? 0}</span>}</a>)}
      </nav>

      <form className="card mb12" style={{ padding: 12 }} role="search">
        <input type="hidden" name="tab" value={tab} />
        <div className="row wrap" style={{ gap: 8, alignItems: "flex-end" }}>
          <div className="field" style={{ flex: 1, minWidth: 200 }}><label htmlFor="q">Search</label><input id="q" name="q" type="search" className="input" defaultValue={sp.q ?? ""} placeholder="Order no, name, mobile" enterKeyHint="search" /></div>
          <button className="btn btn-outline" style={{ minHeight: 42 }}>Search</button>
        </div>
        <details className="so-filters" open={filtered && !sp.q}>
          <summary>More filters</summary>
          <div className="row wrap" style={{ gap: 8, alignItems: "flex-end" }}>
            <div className="field"><label htmlFor="pay">Payment</label><select id="pay" name="payment" className="input select" defaultValue={sp.payment ?? ""}><option value="">All</option>{Object.entries(PAYMENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div className="field"><label htmlFor="m">Method</label><select id="m" name="method" className="input select" defaultValue={sp.method ?? ""}><option value="">All</option><option value="cod">Cash on Delivery</option><option value="online">Prepaid (online)</option></select></div>
            <div className="field"><label htmlFor="from">From</label><input id="from" type="date" name="from" className="input" defaultValue={sp.from ?? ""} /></div>
            <div className="field"><label htmlFor="to">To</label><input id="to" type="date" name="to" className="input" defaultValue={sp.to ?? ""} /></div>
            <button className="btn btn-outline" style={{ minHeight: 42 }}>Apply</button>
            {filtered && <a className="small orange" href={`?tab=${tab}`}>Clear filters</a>}
          </div>
        </details>
      </form>

      <p className="small muted">{all.length} order(s){tab !== "cancelled" && tab !== "unpaid" ? ` · ${rupees(total)}` : ""}{tab === "pending" && all.length > 0 ? " · oldest first" : ""}</p>
      <OrdersBoard rows={board} tab={tab} selectable={tab === "pending" || tab === "all"} />

      {all.length > PER_PAGE && (
        <nav className="so-pager" aria-label="Pages">
          {page > 1 ? <a className="btn btn-outline" href={qs({ page: page - 1 })}>← Previous</a> : <span />}
          <span className="small muted">Page {page} of {Math.ceil(all.length / PER_PAGE)}</span>
          {page * PER_PAGE < all.length ? <a className="btn btn-outline" href={qs({ page: page + 1 })}>Next →</a> : <span />}
        </nav>
      )}
    </>
  );
}
