import { rupees } from "@/lib/store-themes";
import { FULFILMENT_LABEL, PAYMENT_LABEL, listStoreOrders } from "@/server/store/orders";
import { requireStorePage } from "@/server/store/portal";
import "@/styles/store.css";

export const metadata = { title: "Store orders — Vishwaship" };
type SP = Promise<{ q?: string; payment?: string; fulfilment?: string; method?: string; from?: string; to?: string }>;

const PAY_CHIP: Record<string, string> = { paid: "c-active", cod_pending: "c-draft", pending: "c-draft", failed: "c-cancelled", refund_due: "c-cancelled", refunded: "c-draft" };
const FUL_CHIP: Record<string, string> = { delivered: "c-active", in_transit: "c-active", booked: "c-active", unfulfilled: "c-draft", booking: "c-draft", rto: "c-cancelled", cancelled: "c-cancelled" };

export default async function StoreOrders({ searchParams }: { searchParams: SP }) {
  const { ctx } = await requireStorePage();
  const sp = await searchParams;
  const rows = await listStoreOrders(ctx.org.id, sp);
  const total = rows.filter((r) => r.status !== "cancelled").reduce((s, r) => s + r.totalPaise, 0);
  return (
    <>
      <div className="page-h"><div><p className="small muted" style={{ margin: 0 }}><a href="/portal/store/">Online Store</a></p><h1>Store orders</h1>
        <p className="small muted" style={{ margin: "4px 0 0" }}>Orders placed on your website. Ship them from here — courier booking, labels and tracking use your Vishwaship account.</p></div></div>
      <form className="card mb12 row wrap" style={{ padding: 12, gap: 8, alignItems: "flex-end" }} role="search">
        <div className="field"><label htmlFor="q">Search</label><input id="q" name="q" className="input" defaultValue={sp.q ?? ""} placeholder="Order no, name, mobile" /></div>
        <div className="field"><label htmlFor="pay">Payment</label><select id="pay" name="payment" className="input select" defaultValue={sp.payment ?? ""}><option value="">All</option>{Object.entries(PAYMENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div className="field"><label htmlFor="ful">Delivery</label><select id="ful" name="fulfilment" className="input select" defaultValue={sp.fulfilment ?? ""}><option value="">All</option>{Object.entries(FULFILMENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div className="field"><label htmlFor="m">Method</label><select id="m" name="method" className="input select" defaultValue={sp.method ?? ""}><option value="">All</option><option value="cod">Cash on Delivery</option><option value="razorpay">Online</option></select></div>
        <div className="field"><label htmlFor="from">From</label><input id="from" type="date" name="from" className="input" defaultValue={sp.from ?? ""} /></div>
        <div className="field"><label htmlFor="to">To</label><input id="to" type="date" name="to" className="input" defaultValue={sp.to ?? ""} /></div>
        <button className="btn btn-outline">Filter</button>
      </form>
      <p className="small muted">{rows.length} order(s) · {rupees(total)} (excluding cancelled)</p>
      <div className="card p0" style={{ overflowX: "auto" }}>
        {rows.length ? (
          <table className="os-dns">
            <thead><tr><th>Order</th><th>Date</th><th>Buyer</th><th>Items</th><th>Total</th><th>Payment</th><th>Delivery</th><th>AWB</th></tr></thead>
            <tbody>{rows.map((o) => (
              <tr key={o.id}>
                <td><a className="orange" style={{ fontWeight: 600 }} href={`/portal/store/orders/${o.id}/`}>{o.number}</a></td>
                <td className="small">{o.createdAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                <td className="small">{o.buyer.name}<div className="tiny muted">{o.buyer.city} {o.buyer.pincode}</div></td>
                <td className="small">{o.lines.reduce((n, l) => n + l.qty, 0)}</td>
                <td>{rupees(o.totalPaise)}</td>
                <td><span className={`chip ${PAY_CHIP[o.paymentStatus] ?? "c-draft"}`}>{PAYMENT_LABEL[o.paymentStatus] ?? o.paymentStatus}</span>{o.cod !== "not_cod" && o.cod !== "payable" && <div className="tiny muted">COD {o.cod}</div>}</td>
                <td><span className={`chip ${FUL_CHIP[o.fulfilment] ?? "c-draft"}`}>{FULFILMENT_LABEL[o.fulfilment]}</span></td>
                <td className="small mono">{o.awb ?? "—"}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : <p className="muted" style={{ padding: 24, textAlign: "center" }}>No orders yet. Share your store link to get your first order.</p>}
      </div>
    </>
  );
}
