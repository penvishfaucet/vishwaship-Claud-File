import Link from "next/link";
import { and, desc, eq, ilike, inArray, lt, or, type SQL } from "drizzle-orm";
import { Download } from "lucide-react";
import { formatINR } from "@/lib/money";
import { carrierLogo } from "@/lib/site";
import { STATUS_GROUPS, StatusChip } from "@/lib/status";
import { can } from "@/server/auth/rbac";
import { requireStaff } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";

type SP = { q?: string; status?: string; mode?: string; payment?: string; exception?: string; page?: string };

export default async function AdminShipments({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const s = await requireStaff("shipments.read");
  const showCost = can(s.role, "shipments.cost.read");
  const db = await getDb();
  const conds: SQL[] = [];
  const grp = STATUS_GROUPS.find((g) => g.key === sp.status);
  if (grp) conds.push(inArray(schema.shipments.status, grp.statuses));
  else if (sp.status) conds.push(eq(schema.shipments.status, sp.status));
  if (sp.mode === "B2B" || sp.mode === "B2C") conds.push(eq(schema.orders.mode, sp.mode));
  if (sp.payment === "cod" || sp.payment === "prepaid") conds.push(eq(schema.orders.paymentType, sp.payment));
  if (sp.exception === "stale") conds.push(and(inArray(schema.shipments.status, ["in_transit", "picked_up"]), lt(schema.shipments.lastEventAt, new Date(Date.now() - 72 * 3600_000)))!);
  if (sp.exception === "booking") conds.push(inArray(schema.shipments.bookingStatus, ["pending", "ambiguous"]));
  if (sp.q) {
    const q = `%${sp.q.trim().replace(/[%_]/g, "")}%`;
    conds.push(or(ilike(schema.shipments.awb, q), ilike(schema.shipments.lrNumber, q), ilike(schema.orders.orderNumber, q), ilike(schema.shipments.id, q), ilike(schema.shipments.orderId, q), ilike(schema.shipments.providerOrderRef, q), ilike(schema.orders.externalOrderId, q), ilike(schema.orgs.businessName, q), ilike(schema.shipments.carrierName, q), ilike(schema.shipments.provider, q))!);
  }
  const page = Math.max(1, Number(sp.page ?? 1));
  const rows = await db.select({ s: schema.shipments, o: schema.orders, org: schema.orgs }).from(schema.shipments)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.shipments.orderId)).innerJoin(schema.orgs, eq(schema.orgs.id, schema.shipments.orgId))
    .where(conds.length ? and(...conds) : undefined).orderBy(desc(schema.shipments.createdAt)).limit(50).offset((page - 1) * 50);
  const qs = (p: Partial<SP>) => `/admin/shipments/?${new URLSearchParams(Object.entries({ ...sp, ...p }).filter(([, v]) => v) as [string, string][])}`;
  return (
    <>
      <div className="page-h"><h1>All Shipments</h1><div className="actions"><a className="btn btn-outline" href={`/api/admin/export/shipments?${new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][])}`}><Download size={16} /> Export</a></div></div>
      <form className="row wrap mb12" style={{ gap: 8 }} role="search">
        <label htmlFor="sq" className="sr-only">Search</label>
        <input id="sq" name="q" className="input" defaultValue={sp.q} placeholder="Vishwaship ID, order, external order ID, AWB / LR, customer" style={{ maxWidth: 320 }} />
        <select aria-label="Type" name="mode" className="select" defaultValue={sp.mode ?? ""} style={{ maxWidth: 130 }}><option value="">B2B + B2C</option><option>B2C</option><option>B2B</option></select>
        <select aria-label="Payment" name="payment" className="select" defaultValue={sp.payment ?? ""} style={{ maxWidth: 140 }}><option value="">Paid + COD</option><option value="prepaid">Prepaid</option><option value="cod">COD</option></select>
        <select aria-label="Exceptions" name="exception" className="select" defaultValue={sp.exception ?? ""} style={{ maxWidth: 190 }}><option value="">All</option><option value="booking">Pending booking</option><option value="stale">Tracking gaps</option></select>
        {sp.status && <input type="hidden" name="status" value={sp.status} />}
        <button className="btn btn-navy">Apply</button>
      </form>
      <nav className="tabs" aria-label="Status">
        <Link href={qs({ status: undefined, page: undefined })} className={!sp.status ? "on" : ""}>All</Link>
        {STATUS_GROUPS.map((g) => <Link key={g.key} href={qs({ status: g.key, page: undefined })} className={sp.status === g.key ? "on" : ""}>{g.label}</Link>)}
      </nav>
      <div className="card p0 tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Customer</th><th>Order / AWB</th><th>Carrier</th><th>Provider</th><th>Boxes / wt</th><th>Type</th><th>Status</th><th>Tracking synced</th>{showCost && <th className="r">Cost</th>}<th className="r">Selling</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={10} className="center muted small">No shipments match.</td></tr>}
            {rows.map(({ s: x, o, org }) => (
              <tr key={x.id}>
                <td><Link className="link-navy small" href={`/admin/customers/${org.id}/`}>{org.businessName}</Link></td>
                <td><Link className="b link-navy" href={`/admin/shipments/${x.id}/`}>{o.orderNumber}</Link><div className="mono tiny muted">{x.awb}{x.lrNumber && x.lrNumber !== x.awb ? ` · LR ${x.lrNumber}` : ""}</div><div className="mono tiny muted">{x.id}{x.providerOrderRef && x.providerOrderRef !== x.orderId ? ` · ext ${x.providerOrderRef}` : ""}</div></td>
                <td>{carrierLogo(x.carrierCode) ? <img className="clogo-sm" src={carrierLogo(x.carrierCode)!} alt={x.carrierName} title={x.carrierName} /> : x.carrierName}</td>
                <td className="small">{x.provider}{x.provider === "demo" && <span className="demo-badge" style={{ marginLeft: 4 }}>DEMO</span>}</td>
                <td className="small">{(x.chargeableWeightGrams / 1000).toFixed(1)} kg{x.carrierWeightGrams ? ` / ${(x.carrierWeightGrams / 1000).toFixed(1)}` : ""}</td>
                <td className="small">{o.mode} · {o.paymentType}</td>
                <td><StatusChip status={x.status} /></td>
                <td className="small">{x.lastSyncAt ? x.lastSyncAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}{x.lastSyncError ? <div className="tiny t-debit" title={x.lastSyncError}>sync error</div> : null}</td>
                {showCost && <td className="r small">{formatINR(x.costPaise)}</td>}
                <td className="r small">{formatINR(x.sellPaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <nav className="row between mt12"><span className="small muted">Page {page}</span><span className="row" style={{ gap: 8 }}>{page > 1 && <Link className="btn btn-sm btn-outline" href={qs({ page: String(page - 1) })}>Previous</Link>}{rows.length === 50 && <Link className="btn btn-sm btn-outline" href={qs({ page: String(page + 1) })}>Next</Link>}</span></nav>
    </>
  );
}
