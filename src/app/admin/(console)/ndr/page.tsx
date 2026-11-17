import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { StatusChip } from "@/lib/status";
import { requireStaff } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";

export default async function AdminNdr({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const sp = await searchParams;
  await requireStaff("shipments.read");
  const kind = sp.kind === "rto" ? "rto" : "ndr";
  const db = await getDb();
  const rows = await db.select({ c: schema.ndrCases, s: schema.shipments, o: schema.orgs }).from(schema.ndrCases)
    .innerJoin(schema.shipments, eq(schema.shipments.id, schema.ndrCases.shipmentId)).innerJoin(schema.orgs, eq(schema.orgs.id, schema.ndrCases.orgId))
    .where(eq(schema.ndrCases.kind, kind)).orderBy(desc(schema.ndrCases.createdAt));
  return (
    <>
      <div className="page-h"><h1>NDR / RTO</h1></div>
      <nav className="tabs"><Link href="/admin/ndr/" className={kind === "ndr" ? "on" : ""}>NDR</Link><Link href="/admin/ndr/?kind=rto" className={kind === "rto" ? "on" : ""}>RTO</Link></nav>
      <div className="card p0 tbl-wrap"><table className="tbl"><thead><tr><th>Customer</th><th>AWB</th><th>Reason</th><th>Attempt</th><th>Deadline</th><th>Shipment</th><th>Case</th></tr></thead>
        <tbody>{rows.map(({ c, s, o }) => {
          const overdue = c.deadlineAt && c.deadlineAt.getTime() < Date.now() + 12 * 3600_000 && c.status === "open";
          return <tr key={c.id}><td className="small">{o.businessName}</td><td><Link className="mono tiny link-navy" href={`/admin/shipments/${s.id}/`}>{s.awb}</Link></td><td className="small">{c.reason}</td><td>{c.attempt}</td><td className={overdue ? "small err" : "small"}>{c.deadlineAt?.toLocaleString("en-IN") ?? "—"}</td><td><StatusChip status={s.status} /></td><td className="small">{c.status}{c.requestedAction ? ` · ${c.requestedAction}` : ""}</td></tr>;
        })}</tbody></table></div>
    </>
  );
}
