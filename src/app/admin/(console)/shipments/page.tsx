import Link from "next/link";
import { Download } from "lucide-react";
import { carrierLogo } from "@/lib/site";
import { statusLabel } from "@/lib/status";
import { PAGE_SIZES, TAB_GROUPS, orderStatusText } from "@/lib/order-view";
import { requireStaff } from "@/server/auth/session";
import { adminFilterOptions, adminOrderRows, parseOrderFilters, tabCounts } from "@/server/orders/view";

export const dynamic = "force-dynamic";
type SP = Record<string, string | undefined>;
const TONE_CHIP: Record<string, string> = { green: "c-delivered", red: "c-ndr", blue: "c-in_transit", orange: "c-out_for_delivery", amber: "c-pending", gray: "c-cancelled", navy: "c-pending" };
const SHIP_STATUSES = ["not_booked", "booked", "pickup_pending", "picked_up", "in_transit", "at_delivery_center", "out_for_delivery", "delivered", "ndr", "rto_initiated", "rto_in_transit", "rto_delivered", "cancelled", "lost"];
const when = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * Admin → All Shipments: every customer's orders with the Customer Portal's status tabs, definitions and filters
 * (shared code: same tab / status for an order in both portals). Staff with shipments.read only.
 */
export default async function AdminShipments({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  await requireStaff("shipments.read");
  const f = parseOrderFilters(sp);
  const [list, counts, opts] = await Promise.all([adminOrderRows(f), tabCounts(null, { ...f, tab: "all" }), adminFilterOptions()]);
  const qs = (p: SP) => `/admin/shipments/?${new URLSearchParams(Object.entries({ ...sp, ...p }).filter(([, v]) => v) as [string, string][])}`;
  const pages = Math.max(1, Math.ceil(list.total / f.pageSize));
  const customer = opts.customers.find((c) => c.id === f.customer);
  return (
    <>
      <div className="page-h">
        <div><h1>All Shipments</h1><p className="small muted" style={{ margin: "4px 0 0" }}>Every customer&apos;s B2B and B2C orders with the same statuses customers see. {list.total.toLocaleString("en-IN")} match.</p></div>
        <div className="actions"><a className="btn btn-outline" href={`/api/admin/export/shipments?${new URLSearchParams(Object.entries({ org: f.customer, from: f.from, to: f.to }).filter(([, v]) => v) as [string, string][])}`}><Download size={16} /> Export</a></div>
      </div>

      <form className="card as-filters mb12" role="search">
        <input type="hidden" name="tab" value={f.tab} />
        <div className="field as-q"><label htmlFor="q">Search</label><input id="q" name="q" className="input" defaultValue={f.q} placeholder="Order ID, AWB / LR, customer name or ID" /></div>
        <div className="field"><label htmlFor="customer">Customer</label><select id="customer" name="customer" className="select" defaultValue={f.customer ?? ""}><option value="">All customers</option>{opts.customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="field"><label htmlFor="from">From</label><input id="from" type="date" name="from" className="input" defaultValue={f.from} /></div>
        <div className="field"><label htmlFor="to">To</label><input id="to" type="date" name="to" className="input" defaultValue={f.to} /></div>
        <div className="field"><label htmlFor="dateType">Date of</label><select id="dateType" name="dateType" className="select" defaultValue={f.dateType}><option value="created">Order created</option><option value="booked">Booking</option><option value="delivered">Delivery</option></select></div>
        <div className="field"><label htmlFor="courier">Courier</label><select id="courier" name="courier" className="select" defaultValue={f.courier ?? ""}><option value="">All couriers</option>{opts.couriers.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}</select></div>
        <div className="field"><label htmlFor="type">Type</label><select id="type" name="type" className="select" defaultValue={f.type ?? ""}><option value="">B2B + B2C</option><option value="B2C">B2C</option><option value="MPS">B2C multi-box (MPS)</option><option value="B2B">B2B</option></select></div>
        <div className="field"><label htmlFor="status">Shipment status</label><select id="status" name="status" className="select" defaultValue={f.status ?? ""}><option value="">Any status</option>{SHIP_STATUSES.map((s) => <option key={s} value={s}>{s === "not_booked" ? "Not booked yet" : statusLabel(s)}</option>)}</select></div>
        <div className="field"><label htmlFor="payment">Payment</label><select id="payment" name="payment" className="select" defaultValue={f.payment ?? ""}><option value="">Any</option><option value="prepaid">Prepaid</option><option value="cod">COD</option><option value="fod">FOD</option></select></div>
        <div className="field"><label htmlFor="exception">Exceptions</label><select id="exception" name="exception" className="select" defaultValue={f.exception ?? ""}><option value="">None</option><option value="booking">Booking being confirmed</option><option value="stale">No scan for 72 h</option></select></div>
        <div className="field"><label htmlFor="direction">Direction</label><select id="direction" name="direction" className="select" defaultValue={f.direction}><option value="forward">Forward</option><option value="reverse">Returns</option></select></div>
        <div className="row" style={{ gap: 8, alignItems: "end" }}><button className="btn btn-navy">Apply</button><Link className="btn btn-outline" href="/admin/shipments/">Reset</Link></div>
      </form>
      {customer && <p className="small mb8">Showing <b>{customer.name}</b> only · <Link className="link-navy" href={`/admin/customers/${customer.id}/`}>Open customer profile</Link> · <Link className="link-navy" href={qs({ customer: undefined, page: undefined })}>All customers</Link></p>}

      <nav className="as-tabs" aria-label="Status">
        {TAB_GROUPS.map((g) => (
          <div key={g.title || "all"} className="as-tabg">
            {g.title && <span className="as-tabh">{g.title}</span>}
            <div className="as-tabr">{g.tabs.map((t) => <Link key={t.key} href={qs({ tab: t.key, page: undefined })} className={f.tab === t.key ? "on" : ""} aria-current={f.tab === t.key ? "page" : undefined}>{t.label} <span className="n">{counts[t.key].toLocaleString("en-IN")}</span></Link>)}</div>
          </div>
        ))}
        <div className="as-tabg"><span className="as-tabh">Closed</span><div className="as-tabr"><Link href={qs({ tab: "all", status: "cancelled", page: undefined })} className={f.status === "cancelled" ? "on" : ""}>Cancelled</Link><Link href={qs({ tab: "all", status: "lost", page: undefined })} className={f.status === "lost" ? "on" : ""}>Lost</Link></div></div>
      </nav>

      <div className="card p0 tbl-wrap">
        <table className="tbl as-tbl">
          <thead><tr><th>Order ID</th><th>AWB / LR</th><th>Customer</th><th>Booking date</th><th>Courier</th><th>Type</th><th>Status</th></tr></thead>
          <tbody>
            {list.rows.length === 0 && <tr><td colSpan={7} className="center muted small">No shipments match these filters.</td></tr>}
            {list.rows.map((r) => {
              const st = orderStatusText(r);
              const s = r.shipment;
              return (
                <tr key={r.id}>
                  <td>{s ? <Link className="b link-navy" href={`/admin/shipments/${s.id}/`}>{r.orderNumber}</Link> : <span className="b">{r.orderNumber}</span>}<div className="tiny muted">{r.payment.toUpperCase()}</div></td>
                  <td className="mono small">{s?.awb ? <Link className="id-link" href={`/admin/shipments/${s.id}/#tracking`}>{s.awb}</Link> : <span className="muted">—</span>}{s?.lr && <div className="tiny muted">LR {s.lr}</div>}</td>
                  <td className="small"><Link className="link-navy" href={`/admin/customers/${r.customer.id}/`}>{r.customer.name}</Link><div className="tiny muted mono">{r.customer.id}</div></td>
                  <td className="small nowrap">{s ? when(s.bookedAt) : <span className="muted">Not booked · {when(r.createdAt)}</span>}</td>
                  <td className="small">{s ? (carrierLogo(s.carrierCode) ? <img className="clogo-sm" src={carrierLogo(s.carrierCode)!} alt={s.carrierName} title={s.carrierName} /> : s.carrierName) : "—"}{s?.provider === "demo" && <span className="demo-badge" style={{ marginLeft: 4 }}>DEMO</span>}</td>
                  <td className="small">{r.type}</td>
                  <td><span className={`chip ${TONE_CHIP[st.tone] ?? "c-pending"}`}>{st.text}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <nav className="row between wrap mt12" style={{ gap: 8 }} aria-label="Pages">
        <span className="small muted">Page {f.page} of {pages} · {list.total.toLocaleString("en-IN")} orders</span>
        <span className="row" style={{ gap: 8 }}>
          <form className="row" style={{ gap: 6 }}>{Object.entries(sp).filter(([k, v]) => v && k !== "size" && k !== "page").map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}<label htmlFor="size" className="small muted">Rows</label><select id="size" name="size" className="select" defaultValue={String(f.pageSize)} style={{ width: 80 }}>{PAGE_SIZES.map((n) => <option key={n}>{n}</option>)}</select><button className="btn btn-sm btn-outline">Set</button></form>
          {f.page > 1 && <Link className="btn btn-sm btn-outline" href={qs({ page: String(f.page - 1) })}>Previous</Link>}
          {f.page < pages && <Link className="btn btn-sm btn-outline" href={qs({ page: String(f.page + 1) })}>Next</Link>}
        </span>
      </nav>
    </>
  );
}
