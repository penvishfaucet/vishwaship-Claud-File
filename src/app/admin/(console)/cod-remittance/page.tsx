import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { AdminOpForm } from "@/components/admin/AdminOpForm";
import { formatINR } from "@/lib/money";
import { can } from "@/server/auth/rbac";
import { requireStaff } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { earlyCodTerms } from "@/server/early-cod";

const d = (x: Date | null) => x?.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }) ?? "—";

export default async function AdminCodRemittance() {
  const s = await requireStaff("finance.read");
  const remit = can(s.role, "cod.remit");
  const termsWrite = can(s.role, "finance.adjust");
  const db = await getDb();
  const pending = await db.select({ orgId: schema.shipments.orgId, name: schema.orgs.businessName, n: sql<number>`count(*)::int`, cod: sql<number>`coalesce(sum(${schema.orders.codAmountPaise}),0)::bigint` })
    .from(schema.shipments).innerJoin(schema.orders, eq(schema.orders.id, schema.shipments.orderId)).innerJoin(schema.orgs, eq(schema.orgs.id, schema.shipments.orgId))
    .leftJoin(schema.codRemittanceItems, eq(schema.codRemittanceItems.shipmentId, schema.shipments.id))
    .where(and(eq(schema.orders.paymentType, "cod"), eq(schema.shipments.status, "delivered"), isNull(schema.codRemittanceItems.shipmentId)))
    .groupBy(schema.shipments.orgId, schema.orgs.businessName);
  const subs = await db.select({ e: schema.earlyCodSubscriptions, name: schema.orgs.businessName }).from(schema.earlyCodSubscriptions).innerJoin(schema.orgs, eq(schema.orgs.id, schema.earlyCodSubscriptions.orgId)).orderBy(desc(schema.earlyCodSubscriptions.startedAt)).limit(100);
  const batches = await db.select({ r: schema.codRemittances, name: schema.orgs.businessName }).from(schema.codRemittances).innerJoin(schema.orgs, eq(schema.orgs.id, schema.codRemittances.orgId)).orderBy(desc(schema.codRemittances.createdAt)).limit(100);
  const terms = await earlyCodTerms();
  const activeEarly = new Set(subs.filter((x) => x.e.status === "active").map((x) => x.e.orgId));
  const inDays = (n: number) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);
  return (
    <>
      <div className="page-h"><div><h1>COD Remittance &amp; Early COD</h1><p className="small muted" style={{ margin: "4px 0 0" }}>Group delivered COD into payouts, record the bank reference when paid, and manage Early COD terms. Each shipment can be in only one payout.</p></div></div>
      <section className="card p0 mb16">
        <h2 className="b small card-h" style={{ margin: 0 }}>Delivered COD awaiting remittance</h2>
        {pending.length === 0 ? <p className="small muted" style={{ padding: 16 }}>Nothing waiting.</p> : (
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Customer</th><th>Shipments</th><th style={{ textAlign: "right" }}>COD</th><th>Early COD</th><th>Create payout</th></tr></thead>
            <tbody>{pending.map((p) => (
              <tr key={p.orgId}><td className="small b">{p.name}</td><td className="small">{p.n}</td><td style={{ textAlign: "right" }} className="small">{formatINR(Number(p.cod))}</td><td>{activeEarly.has(p.orgId) ? <span className="chip c-active">Subscribed</span> : <span className="small muted">—</span>}</td>
                <td><AdminOpForm op="remittance_create" submit="Schedule payout" disabled={!remit} confirmText={`Create a payout of ${p.n} shipments for ${p.name}?`}
                  fields={[{ name: "orgId", label: "", type: "hidden", value: p.orgId }, { name: "payoutDate", label: "Payout date", type: "date", value: inDays(activeEarly.has(p.orgId) ? terms.cycleDays : terms.standardCycleDays) }, { name: "early", label: "Early COD (deduct fee)", type: "checkbox", value: activeEarly.has(p.orgId) }]} /></td></tr>
            ))}</tbody></table></div>
        )}
      </section>
      <section className="card p0 mb16">
        <h2 className="b small card-h" style={{ margin: 0 }}>Payouts</h2>
        {batches.length === 0 ? <p className="small muted" style={{ padding: 16 }}>No payouts yet.</p> : (
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Created</th><th>Customer</th><th style={{ textAlign: "right" }}>Gross</th><th style={{ textAlign: "right" }}>Deductions</th><th style={{ textAlign: "right" }}>Net</th><th>Due</th><th>Status</th><th>Reference / action</th></tr></thead>
            <tbody>{batches.map(({ r, name }) => (
              <tr key={r.id}><td className="small">{d(r.createdAt)}</td><td className="small">{name}{r.earlyCod && <span className="chip c-pending" style={{ marginLeft: 6 }}>Early</span>}</td><td style={{ textAlign: "right" }} className="small">{formatINR(r.grossPaise)}</td><td style={{ textAlign: "right" }} className="small" title={r.deductionNote ?? ""}>{formatINR(r.deductionsPaise)}</td><td style={{ textAlign: "right" }} className="small b">{formatINR(r.netPaise)}</td><td className="small">{d(r.expectedPayoutAt)}</td>
                <td><span className={`chip ${r.status === "paid" ? "c-active" : r.status === "cancelled" ? "c-draft" : "c-pending"}`}>{r.status}</span></td>
                <td>{r.status === "scheduled" && remit ? <><AdminOpForm op="remittance_paid" submit="Mark paid" fields={[{ name: "id", label: "", type: "hidden", value: r.id }, { name: "reference", label: "Bank UTR / ref", placeholder: "UTR" }]} /><AdminOpForm op="remittance_cancel" submit="Cancel payout" confirmText="Cancel this payout? Its shipments return to the next cycle." fields={[{ name: "id", label: "", type: "hidden", value: r.id }]} /></> : <span className="small mono">{r.reference ?? "—"}</span>}</td></tr>
            ))}</tbody></table></div>
        )}
      </section>
      <div className="split" style={{ gap: 16, alignItems: "start" }}>
        <section className="card" style={{ padding: 16 }}>
          <h2 className="b" style={{ fontSize: 15, marginTop: 0 }}>Early COD terms <span className="tiny muted">v{terms.version}</span></h2>
          <AdminOpForm op="early_cod_terms" submit="Save terms" disabled={!termsWrite} fields={[
            { name: "enabled", label: "Open for new subscriptions", type: "checkbox", value: terms.enabled, wide: true },
            { name: "feePct", label: "Fee (% of COD)", type: "number", step: "0.01", value: terms.feeBps / 100 },
            { name: "cycleDays", label: "Early payout D+", type: "number", value: terms.cycleDays },
            { name: "standardCycleDays", label: "Standard payout D+", type: "number", value: terms.standardCycleDays },
            { name: "minDelivered", label: "Min delivered COD shipments", type: "number", value: terms.minDelivered },
            { name: "requireKyc", label: "Require approved KYC", type: "checkbox", value: terms.requireKyc },
          ]} />
          <p className="tiny muted mt8">Changing the fee, schedule or eligibility creates a new terms version. Existing subscribers keep the terms they accepted. Customer-facing terms text: Admin → Content → “Early COD — terms”.</p>
        </section>
        <section className="card p0">
          <h2 className="b small card-h" style={{ margin: 0 }}>Early COD subscriptions</h2>
          {subs.length === 0 ? <p className="small muted" style={{ padding: 16 }}>None yet.</p> : <ul className="plain-list">{subs.map(({ e, name }) => <li key={e.id} className="row between small"><span>{name} · {e.feeBps / 100}% · D+{e.cycleDays} · terms v{e.termsVersion}</span><span className={`chip ${e.status === "active" ? "c-active" : "c-draft"}`}>{e.status}</span></li>)}</ul>}
        </section>
      </div>
    </>
  );
}
