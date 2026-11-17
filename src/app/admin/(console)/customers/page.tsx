import Link from "next/link";
import { count, desc, eq, ilike, or } from "drizzle-orm";
import { formatINR } from "@/lib/money";
import { requireStaff } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; kyc?: string }> }) {
  const sp = await searchParams;
  await requireStaff("customers.read");
  const db = await getDb();
  const q = sp.q ? `%${sp.q.replace(/[%_]/g, "")}%` : null;
  const rows = await db.select({ o: schema.orgs, w: schema.wallets }).from(schema.orgs).leftJoin(schema.wallets, eq(schema.wallets.orgId, schema.orgs.id))
    .where(q ? or(ilike(schema.orgs.businessName, q), ilike(schema.orgs.id, q), ilike(schema.orgs.gstin, q)) : undefined).orderBy(desc(schema.orgs.createdAt));
  const counts = await db.select({ orgId: schema.shipments.orgId, n: count() }).from(schema.shipments).groupBy(schema.shipments.orgId);
  const list = rows.filter((r) => !sp.kyc || r.o.kycStatus === sp.kyc);
  return (
    <>
      <div className="page-h"><h1>Customers</h1></div>
      <form className="row wrap mb12" style={{ gap: 8 }} role="search">
        <label htmlFor="cq" className="sr-only">Search</label><input id="cq" name="q" className="input" defaultValue={sp.q} placeholder="Business, ID or GSTIN" style={{ maxWidth: 280 }} />
        <select aria-label="KYC status" name="kyc" className="select" defaultValue={sp.kyc ?? ""} style={{ maxWidth: 180 }}><option value="">All KYC</option>{["not_started", "pending", "approved", "changes_requested", "rejected"].map((k) => <option key={k} value={k}>{k.replace("_", " ")}</option>)}</select>
        <button className="btn btn-navy">Apply</button>
      </form>
      <div className="card p0 tbl-wrap"><table className="tbl"><thead><tr><th>Customer</th><th>GSTIN</th><th>KYC</th><th>Status</th><th>Shipments</th><th className="r">Wallet</th><th>Joined</th></tr></thead>
        <tbody>{list.map(({ o, w }) => <tr key={o.id}><td><Link className="b link-navy" href={`/admin/customers/${o.id}/`}>{o.businessName}</Link><div className="tiny muted mono">{o.id}</div></td><td className="mono tiny">{o.gstin ?? "—"}</td><td><span className="chip c-pending">{o.kycStatus.replace("_", " ")}</span></td><td><span className={`chip ${o.status === "active" ? "c-active" : "c-cancelled"}`}>{o.status}</span></td><td>{Number(counts.find((c) => c.orgId === o.id)?.n ?? 0)}</td><td className="r">{formatINR(w ? w.postedPaise - w.reservedPaise : 0)}</td><td className="small">{o.createdAt.toLocaleDateString("en-IN")}</td></tr>)}</tbody></table></div>
    </>
  );
}
