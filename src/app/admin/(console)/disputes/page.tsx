import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { formatINR } from "@/lib/money";
import { audit } from "@/server/audit";
import { can } from "@/server/auth/rbac";
import { requireStaff } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { withLedger } from "@/server/ledger/db-store";
import { credit, debit } from "@/server/ledger/wallet";

/** charge: posts the validated discrepancy exactly once (key wd-charge:<id>). waive after charge: compensating credit (wd-waive:<id>). */
async function act(fd: FormData) {
  "use server";
  const s = await requireStaff("finance.adjust");
  const id = String(fd.get("id")), action = String(fd.get("action"));
  const db = await getDb();
  const [d] = await db.select().from(schema.weightDisputes).where(eq(schema.weightDisputes.id, id));
  if (!d) return;
  const [w] = await db.select().from(schema.wallets).where(eq(schema.wallets.orgId, d.orgId));
  if (action === "charge" && (d.status === "open" || d.status === "accepted")) {
    await withLedger((st) => debit(st, { walletId: w.id, amount: d.chargePaise, kind: "weight_charge", idempotencyKey: `wd-charge:${id}`, refType: "weight_dispute", refId: id, memo: "Weight discrepancy charge", allowNegative: true }));
    await db.update(schema.weightDisputes).set({ status: "charged", resolution: "Charged per carrier re-weigh" }).where(eq(schema.weightDisputes.id, id));
  } else if (action === "waive") {
    if (d.status === "charged") {
      await withLedger((st) => credit(st, { walletId: w.id, amount: d.chargePaise, kind: "weight_reversal", idempotencyKey: `wd-waive:${id}`, refType: "weight_dispute", refId: id, memo: "Weight discrepancy waived (reversal)" }));
    }
    await db.update(schema.weightDisputes).set({ status: "waived", resolution: String(fd.get("note") ?? "Waived after review") }).where(eq(schema.weightDisputes.id, id));
  } else return;
  await audit({ actorUserId: s.userId, actorKind: "staff", orgId: d.orgId, action: `weight_dispute.${action}`, targetType: "weight_dispute", targetId: id });
  redirect("/admin/disputes/");
}

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
            <td>{fin && d.status !== "waived" && <form action={act} className="row" style={{ gap: 4 }}><input type="hidden" name="id" value={d.id} />{d.status !== "charged" && <button name="action" value="charge" className="btn btn-sm btn-navy">Charge</button>}<button name="action" value="waive" className="btn btn-sm btn-outline">Waive</button></form>}</td></tr>
        ))}</tbody></table></div>
    </>
  );
}
