import { desc, eq } from "drizzle-orm";
import { formatINR } from "@/lib/money";
import { DisputeButtons } from "@/components/admin/DisputeButtons";
import { WeightImport } from "@/components/admin/WeightImport";
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
      <div className="page-h"><div><h1>Weight Disputes</h1><p className="small muted" style={{ margin: "4px 0 0" }}>Courier weight above the booked chargeable weight is passed on to the client: re-rated at the booking rate with the same markup, plus GST. Clients get 7 days to dispute; undisputed ones are debited automatically.</p></div></div>
      {fin && <WeightImport />}
      <div className="card p0 tbl-wrap"><table className="tbl"><thead><tr><th>Customer</th><th>AWB</th><th>Declared</th><th>Carrier</th><th>Revised</th><th>Charge</th><th>Courier extra</th><th>Deadline</th><th>Status</th><th /></tr></thead>
        <tbody>{rows.map(({ d, sh, o }) => (
          <tr key={d.id}><td className="small">{o.businessName}</td><td className="mono tiny">{sh.awb}</td><td>{d.declaredGrams / 1000} kg</td><td>{d.carrierGrams / 1000} kg</td><td>{d.revisedChargeableGrams / 1000} kg</td><td>{formatINR(d.chargePaise)}<div className="tiny muted">{d.source}</div></td><td className="small">{(() => { const c = d.calc as { extraCostPreTax?: number; basis?: string } | null; return c?.extraCostPreTax != null ? <>{formatINR(c.extraCostPreTax)}<div className="tiny muted">{c.basis === "courier" ? "from report" : "re-rated"} · pre-GST</div></> : "—"; })()}</td><td className="small">{d.deadlineAt.toLocaleDateString("en-IN")}</td><td><span className="chip c-pending">{d.status}</span>{(d.evidence as Array<{ by?: string; note?: string; claimedGrams?: number; urls?: string[] }>).filter((e) => e.by === "seller").map((e, i) => <div key={i} className="tiny" style={{ maxWidth: 260 }}><b>Seller:</b> {e.claimedGrams ? `${e.claimedGrams / 1000} kg — ` : ""}{e.note}{e.urls?.map((u, j) => <a key={j} className="link" href={u} target="_blank" rel="noreferrer noopener" style={{ marginLeft: 4 }}>[{j + 1}]</a>)}</div>)}</td>
            <td>{fin && d.status !== "waived" && <DisputeButtons id={d.id} status={d.status} />}</td></tr>
        ))}</tbody></table></div>
    </>
  );
}
