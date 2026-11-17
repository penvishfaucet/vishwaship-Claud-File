import Link from "next/link";
import { count, desc, eq, ilike, or } from "drizzle-orm";
import { LogIn, Wallet } from "lucide-react";
import { formatINR } from "@/lib/money";
import { loginAsCustomer } from "@/server/admin/impersonate";
import { can } from "@/server/auth/rbac";
import { requireStaff } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; kyc?: string; sort?: string }> }) {
  const sp = await searchParams;
  const s = await requireStaff("customers.read");
  const canLoginAs = can(s.role, "customers.impersonate");
  const db = await getDb();
  const q = sp.q ? `%${sp.q.replace(/[%_]/g, "")}%` : null;
  const rows = await db.select({ o: schema.orgs, w: schema.wallets }).from(schema.orgs).leftJoin(schema.wallets, eq(schema.wallets.orgId, schema.orgs.id))
    .where(q ? or(ilike(schema.orgs.businessName, q), ilike(schema.orgs.id, q), ilike(schema.orgs.gstin, q)) : undefined).orderBy(desc(schema.orgs.createdAt));
  const counts = await db.select({ orgId: schema.shipments.orgId, n: count() }).from(schema.shipments).groupBy(schema.shipments.orgId);
  const avail = (w: typeof rows[number]["w"]) => (w ? w.postedPaise - w.reservedPaise : 0);
  let list = rows.filter((r) => !sp.kyc || r.o.kycStatus === sp.kyc);
  if (sp.sort === "wallet") list = [...list].sort((a, b) => avail(b.w) - avail(a.w));
  const totalAvail = list.reduce((t, r) => t + avail(r.w), 0);
  const totalHold = list.reduce((t, r) => t + (r.w?.reservedPaise ?? 0), 0);
  return (
    <>
      <div className="page-h"><h1>Customers</h1></div>
      <div className="stats mb16">
        <div className="stat bl-orange"><div className="t"><Wallet size={14} /> Total wallet balance (available)</div><div className="v">{formatINR(totalAvail)}</div><div className="s">{list.length} customer{list.length === 1 ? "" : "s"}{sp.q || sp.kyc ? " (filtered)" : ""}</div></div>
        <div className="stat bl-blue"><div className="t">On hold for bookings</div><div className="v">{formatINR(totalHold)}</div></div>
      </div>
      <form className="row wrap mb12" style={{ gap: 8 }} role="search">
        <label htmlFor="cq" className="sr-only">Search</label><input id="cq" name="q" className="input" defaultValue={sp.q} placeholder="Business, ID or GSTIN" style={{ maxWidth: 280 }} />
        <select aria-label="KYC status" name="kyc" className="select" defaultValue={sp.kyc ?? ""} style={{ maxWidth: 180 }}><option value="">All KYC</option>{["not_started", "pending", "approved", "changes_requested", "rejected"].map((k) => <option key={k} value={k}>{k.replace("_", " ")}</option>)}</select>
        <select aria-label="Sort" name="sort" className="select" defaultValue={sp.sort ?? ""} style={{ maxWidth: 200 }}><option value="">Newest first</option><option value="wallet">Highest wallet balance</option></select>
        <button className="btn btn-navy">Apply</button>
      </form>
      <div className="card p0 tbl-wrap"><table className="tbl">
        <thead><tr><th>Customer</th><th>GSTIN</th><th>KYC</th><th>Status</th><th>Shipments</th><th className="r">Wallet balance</th><th>Joined</th>{canLoginAs && <th><span className="sr-only">Login as customer</span></th>}</tr></thead>
        <tbody>{list.map(({ o, w }) => (
          <tr key={o.id}>
            <td><Link className="b link-navy" href={`/admin/customers/${o.id}/`}>{o.businessName}</Link><div className="tiny muted mono">{o.id}</div></td>
            <td className="mono tiny">{o.gstin ?? "—"}</td>
            <td><span className="chip c-pending">{o.kycStatus.replace("_", " ")}</span></td>
            <td><span className={`chip ${o.status === "active" ? "c-active" : "c-cancelled"}`}>{o.status}</span></td>
            <td>{Number(counts.find((c) => c.orgId === o.id)?.n ?? 0)}</td>
            <td className="r"><Link className="b link-navy" href={`/admin/customers/${o.id}/?tab=wallet`}>{formatINR(avail(w))}</Link>{w && w.reservedPaise > 0 && <div className="tiny muted">+ {formatINR(w.reservedPaise)} on hold</div>}</td>
            <td className="small">{o.createdAt.toLocaleDateString("en-IN")}</td>
            {canLoginAs && <td><form action={loginAsCustomer}><input type="hidden" name="orgId" value={o.id} /><button className="btn btn-sm btn-outline" title={`Open ${o.businessName}'s customer portal`}><LogIn size={14} /> Login as customer</button></form></td>}
          </tr>
        ))}</tbody>
        <tfoot><tr><td colSpan={5} className="b">Total</td><td className="r b">{formatINR(totalAvail)}</td><td colSpan={canLoginAs ? 2 : 1} /></tr></tfoot>
      </table></div>
    </>
  );
}
