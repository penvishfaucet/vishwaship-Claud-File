import { desc, eq } from "drizzle-orm";
import { formatINR } from "@/lib/money";
import { resolveDispute } from "@/server/admin/dispute-actions";
import { can } from "@/server/auth/rbac";
import { requireStaff } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";

export default async function Disputes() {
  const s = await requireStaff("shipments.read");
  const db = await getDb();
  const rows = await db.select({ d: schema.weightDisputes, sh: schema.shipments, o: schema.orgs }).from(schema.weightDisputes)
    .innerJoin(schema.shipments, eq(schema.shipments.id, schema.weightDisputes.shipmentId)).innerJoin(schema.orgs, eq(schema.orgs.id, schema.weightDisputes.orgId)).orderBy(desc(schema.weightDisputes.createdAt));
  const fin = can(s.role, "finance.adjust");
  return (
    <>
      <div className="page-h"><h1>Weight Disputes</h1></div>
      <div className="card p0 tbl-wrap"><table className="tbl"><thead><tr><th>Customer</th><th>AWB</th><th>Declared</th><th>Carrier</th><th>Revised</th><th>Charge</th><th>Deadline</th><th>Status</th><th /></tr></thead>
        <tbody>{rows.map(({ d, sh, o }) => (
          <tr key={d.id}><td className="small">{o.businessName}</td><td className="mono tiny">{sh.awb}</td><td>{d.declaredGrams / 1000} kg</td><td>{d.carrierGrams / 1000} kg</td><td>{d.revisedChargeableGrams / 1000} kg</td><td>{formatINR(d.chargePaise)}</td><td className="small">{d.deadlineAt.toLocaleDateString("en-IN")}</td><td><span className="chip c-pending">{d.status}</span></td>
            <td>{fin && d.status !== "waived" && (
              <div className="row" style={{ gap: 4 }}>
                {d.status !== "charged" && <form action={resolveDispute}><input type="hidden" name="id" value={d.id} /><input type="hidden" name="op" value="charge" /><button className="btn btn-sm btn-navy">Charge</button></form>}
                <form action={resolveDispute}><input type="hidden" name="id" value={d.id} /><input type="hidden" name="op" value="waive" /><button className="btn btn-sm btn-outline">Waive</button></form>
              </div>
            )}</td></tr>
        ))}</tbody></table></div>
    </>
  );
}
