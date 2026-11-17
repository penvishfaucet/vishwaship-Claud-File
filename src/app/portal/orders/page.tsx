import Link from "next/link";
import { Download, FileStack, PackagePlus, RefreshCw, Upload, Zap } from "lucide-react";
import { formatINR } from "@/lib/money";
import { carrierLogo } from "@/lib/site";
import { STATUS_GROUPS, StatusChip } from "@/lib/status";
import { portalContext } from "@/server/portal/context";
import { listOrders, statusCounts } from "@/server/portal/queries";

type SP = { q?: string; group?: string; payment?: string; mode?: string; page?: string };

export default async function OrdersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await portalContext();
  const [counts, data] = await Promise.all([
    statusCounts(ctx.org.id),
    listOrders(ctx.org.id, { q: sp.q, group: sp.group, payment: sp.payment, mode: sp.mode, page: Number(sp.page ?? 1) }),
  ]);
  const all = counts.reduce((s, c) => s + c.count, 0);
  const qs = (patch: Partial<SP>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/portal/orders/?${p.toString()}`;
  };
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <>
      <div className="page-h">
        <h1>Orders</h1>
        <div className="actions">
          <Link className="btn btn-orange" href="/portal/orders/new/"><PackagePlus size={16} /> Add Order</Link>
          <Link className="btn btn-outline" href="/portal/orders/new/?quick=1"><Zap size={16} /> Quick Add</Link>
          <Link className="btn btn-outline hide-sm" href="/portal/orders/bulk/"><Upload size={16} /> Bulk Upload</Link>
          <Link className="btn btn-outline hide-sm" href="/portal/integrations/"><RefreshCw size={16} /> Store Sync</Link>
          <Link className="btn btn-outline hide-sm" href="/portal/orders/?group=drafts"><FileStack size={16} /> Drafts</Link>
          <a className="btn btn-outline hide-sm" href={`/api/portal/export/orders?${new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString()}`}><Download size={16} /> Export</a>
        </div>
      </div>

      <nav className="tabs" aria-label="Order status">
        <Link href={qs({ group: undefined, page: undefined })} className={!sp.group ? "on" : ""}>All<span className="n">{all}</span></Link>
        {counts.map((c) => <Link key={c.key} href={qs({ group: c.key, page: undefined })} className={sp.group === c.key ? "on" : ""}>{c.label}<span className="n">{c.count}</span></Link>)}
      </nav>

      <form className="row wrap mb12" style={{ gap: 8 }} role="search">
        {sp.group && <input type="hidden" name="group" value={sp.group} />}
        <label className="sr-only" htmlFor="oq">Search</label>
        <input id="oq" className="input" name="q" defaultValue={sp.q} placeholder="Order ID, AWB / LR, phone" style={{ maxWidth: 280 }} />
        <label className="sr-only" htmlFor="opay">Payment</label>
        <select id="opay" className="select" name="payment" defaultValue={sp.payment ?? ""} style={{ maxWidth: 150 }}><option value="">All payments</option><option value="prepaid">Prepaid</option><option value="cod">COD</option></select>
        <label className="sr-only" htmlFor="omode">Type</label>
        <select id="omode" className="select" name="mode" defaultValue={sp.mode ?? ""} style={{ maxWidth: 130 }}><option value="">B2C + B2B</option><option value="B2C">B2C</option><option value="B2B">B2B</option></select>
        <button className="btn btn-navy">Apply</button>
        {(sp.q || sp.payment || sp.mode) && <Link className="btn btn-outline" href={qs({ q: undefined, payment: undefined, mode: undefined })}>Clear</Link>}
      </form>

      {data.rows.length === 0 ? (
        <div className="card empty"><p className="muted">{sp.q || sp.group ? "No orders match these filters." : "No orders yet."}</p><Link className="btn btn-orange btn-sm" href="/portal/orders/new/">Add Order</Link></div>
      ) : (
        <>
          <div className="card p0 tbl-wrap only-desktop">
            <table className="tbl">
              <thead><tr><th>Order</th><th>Courier</th><th>AWB / LR</th><th>Consignee</th><th>Boxes</th><th>Chargeable</th><th>Payment</th><th>Date</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {data.rows.map((r) => {
                  const c = r.consignee as { name: string; city: string; pincode: string };
                  const logo = r.carrierCode ? carrierLogo(r.carrierCode) : null;
                  return (
                    <tr key={r.orderId}>
                      <td><Link className="b link-navy" href={`/portal/orders/${r.orderId}/`}>{r.orderNumber}</Link><div className="tiny muted">{r.mode}{r.provider === "demo" ? " · demo" : ""}</div></td>
                      <td>{logo ? <img className="clogo-sm" src={logo} alt={r.carrierName ?? ""} title={r.carrierName ?? ""} /> : <span className="muted">—</span>}</td>
                      <td className="mono small">{r.awb ?? <span className="muted">—</span>}</td>
                      <td><div className="small">{c.name}</div><div className="tiny muted">{c.city} {c.pincode}</div></td>
                      <td>{r.boxes}</td>
                      <td>{r.chargeable ? `${(r.chargeable / 1000).toFixed(1)} kg` : "—"}</td>
                      <td><span className={`chip ${r.paymentType === "cod" ? "c-cod" : "c-prepaid"}`}>{r.paymentType === "cod" ? `COD ${formatINR(r.codAmount)}` : "Prepaid"}</span></td>
                      <td className="small">{r.createdAt.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short" })}</td>
                      <td>{r.status ? <StatusChip status={r.status} /> : <span className="chip c-draft">{r.orderStatus}</span>}</td>
                      <td><Link className="btn btn-sm btn-outline" href={`/portal/orders/${r.orderId}/`}>View</Link></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <ul className="only-mobile plain-list card p0">
            {data.rows.map((r) => {
              const c = r.consignee as { name: string; city: string };
              const logo = r.carrierCode ? carrierLogo(r.carrierCode) : null;
              return (
                <li key={r.orderId}>
                  <Link href={`/portal/orders/${r.orderId}/`} style={{ display: "block" }}>
                    <div className="row between"><span className="b">{r.orderNumber}</span>{r.status ? <StatusChip status={r.status} /> : <span className="chip c-draft">{r.orderStatus}</span>}</div>
                    <div className="row between mt8" style={{ gap: 8 }}>
                      <span className="row" style={{ gap: 8 }}>{logo && <img className="clogo-sm" src={logo} alt="" />}<span className="mono tiny">{r.awb ?? "—"}</span></span>
                      <span className="tiny muted">{r.paymentType === "cod" ? `COD ${formatINR(r.codAmount)}` : "Prepaid"} · {r.boxes} box</span>
                    </div>
                    <div className="tiny muted mt8">{c.name}, {c.city} · {r.chargeable ? `${(r.chargeable / 1000).toFixed(1)} kg` : ""}</div>
                  </Link>
                </li>
              );
            })}
          </ul>
          <nav className="row between mt12" aria-label="Pagination">
            <span className="small muted">{data.total} orders · page {data.page} of {pages}</span>
            <span className="row" style={{ gap: 8 }}>
              {data.page > 1 && <Link className="btn btn-sm btn-outline" href={qs({ page: String(data.page - 1) })}>Previous</Link>}
              {data.page < pages && <Link className="btn btn-sm btn-outline" href={qs({ page: String(data.page + 1) })}>Next</Link>}
            </span>
          </nav>
        </>
      )}
    </>
  );
}
