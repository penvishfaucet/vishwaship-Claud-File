import { and, desc, eq, isNull, sql, gt, inArray } from "drizzle-orm";
import { AdminOpForm } from "@/components/admin/AdminOpForm";
import { CodReceiptImport } from "@/components/admin/CodReceiptImport";
import { payoutPreview } from "@/server/cod/payouts";
import { RECEIPT_LABEL, type ReceiptStatus } from "@/server/cod/receipts";
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
    .where(and(gt(schema.orders.codAmountPaise, 0), eq(schema.shipments.status, "delivered"), isNull(schema.codRemittanceItems.shipmentId)))
    .groupBy(schema.shipments.orgId, schema.orgs.businessName);
  const subs = await db.select({ e: schema.earlyCodSubscriptions, name: schema.orgs.businessName }).from(schema.earlyCodSubscriptions).innerJoin(schema.orgs, eq(schema.orgs.id, schema.earlyCodSubscriptions.orgId)).orderBy(desc(schema.earlyCodSubscriptions.startedAt)).limit(100);
  const batches = await db.select({ r: schema.codRemittances, name: schema.orgs.businessName }).from(schema.codRemittances).innerJoin(schema.orgs, eq(schema.orgs.id, schema.codRemittances.orgId)).orderBy(desc(schema.codRemittances.createdAt)).limit(100);
  const terms = await earlyCodTerms();
  const ready = await payoutPreview();
  const payable = ready.filter((p) => !p.blocked);
  const payableNet = payable.reduce((t, p) => t + p.netPaise, 0);
  const toCheck = await db.select({ r: schema.codReceipts, name: schema.orgs.businessName }).from(schema.codReceipts).leftJoin(schema.orgs, eq(schema.orgs.id, schema.codReceipts.orgId))
    .where(inArray(schema.codReceipts.status, ["short", "excess", "unknown_awb", "not_cod"])).orderBy(desc(schema.codReceipts.createdAt)).limit(100);
  const imports = await db.select().from(schema.codReceiptImports).orderBy(desc(schema.codReceiptImports.createdAt)).limit(8);
  const scheduled = batches.filter((b) => b.r.status === "scheduled" && b.r.netPaise > 0);
  const activeEarly = new Set(subs.filter((x) => x.e.status === "active").map((x) => x.e.orgId));
  const inDays = (n: number) => new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10);
  return (
    <>
      <div className="page-h"><div><h1>COD Remittance &amp; Early COD</h1><p className="small muted" style={{ margin: "4px 0 0" }}>Courier pays COD → recorded per AWB → <b>Pay all</b> makes each client&apos;s payout (Online Store fee 1.5% + GST, Early COD fee and wallet dues deducted) → upload the bank file → mark paid with the UTR. Each shipment is paid once.</p></div></div>
      <CodReceiptImport />
      {imports.length > 0 && <p className="tiny muted" style={{ margin: "-8px 0 16px" }}>Last received: {imports.map((i) => `${d(i.createdAt)} ${i.source === "delhivery_mail" ? "Delhivery mail" : i.fileName ?? "file"} (${i.matched} ok${i.flagged ? `, ${i.flagged} to check` : ""}, ${formatINR(i.totalPaise)})`).join(" · ")}</p>}
      {toCheck.length > 0 && (
        <section className="card p0 mb16">
          <h2 className="b small card-h" style={{ margin: 0 }}>Check: courier COD that does not match ({toCheck.length})</h2>
          <p className="tiny muted" style={{ padding: "0 16px" }}>These AWBs are not paid to the client until you accept the courier&apos;s amount (or the courier sends the rest).</p>
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>AWB</th><th>Client</th><th style={{ textAlign: "right" }}>Order COD</th><th style={{ textAlign: "right" }}>Courier paid</th><th>UTR</th><th>Issue</th><th>Action</th></tr></thead>
            <tbody>{toCheck.map(({ r, name }) => (
              <tr key={r.id}><td className="mono tiny">{r.awb}</td><td className="small">{name ?? "—"}</td><td style={{ textAlign: "right" }} className="small">{r.expectedPaise != null ? formatINR(r.expectedPaise) : "—"}</td><td style={{ textAlign: "right" }} className="small b">{formatINR(r.amountPaise)}</td><td className="mono tiny">{r.utr ?? "—"}</td>
                <td><span className="chip c-pending">{RECEIPT_LABEL[r.status as ReceiptStatus] ?? r.status}</span></td>
                <td>{remit && r.shipmentId && (r.status === "short" || r.status === "excess") ? <AdminOpForm op="cod_receipt_accept" submit={`Pay client ${formatINR(r.amountPaise)}`} confirmText={`Pay the client ${formatINR(r.amountPaise)} for AWB ${r.awb} (what the courier paid)?`} fields={[{ name: "id", label: "", type: "hidden", value: r.id }]} /> : <span className="tiny muted">—</span>}</td></tr>
            ))}</tbody></table></div>
        </section>
      )}
      <section className="card p0 mb16">
        <div className="row between" style={{ padding: "12px 16px", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <h2 className="b small" style={{ margin: 0 }}>2 · Ready to pay clients</h2>
          {payable.length > 0 && <AdminOpForm op="cod_run" disabled={!remit} submit={`Pay all · ${payable.length} client${payable.length === 1 ? "" : "s"} · ${formatINR(payableNet)}`} confirmText={`Create payouts for ${payable.length} client(s), ${formatINR(payableNet)} in total? Next: download the bank file and transfer.`} fields={[]} />}
        </div>
        {ready.length === 0 ? <p className="small muted" style={{ padding: 16 }}>Nothing to pay. COD becomes payable when the courier&apos;s COD for the AWB is recorded above (or under Early COD).</p> : (
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Client</th><th>Shipments</th><th style={{ textAlign: "right" }}>COD received</th><th style={{ textAlign: "right" }}>Store fee 1.5% + GST</th><th style={{ textAlign: "right" }}>Early COD fee + GST</th><th style={{ textAlign: "right" }}>Wallet dues</th><th style={{ textAlign: "right" }}>Pay client</th><th>Bank</th></tr></thead>
            <tbody>{ready.map((p) => (
              <tr key={p.orgId}><td className="small b">{p.name}{p.early && <span className="chip c-pending" style={{ marginLeft: 6 }}>Early</span>}{p.awaitingCourier > 0 && <div className="tiny muted">{p.awaitingCourier} more waiting for courier ({formatINR(p.awaitingCourierPaise)})</div>}</td>
                <td className="small">{p.shipments.length}</td><td style={{ textAlign: "right" }} className="small">{formatINR(p.grossPaise)}</td>
                <td style={{ textAlign: "right" }} className="small">{p.storeFeePaise ? `− ${formatINR(p.storeFeePaise)}` : "—"}</td><td style={{ textAlign: "right" }} className="small">{p.earlyFeePaise ? `− ${formatINR(p.earlyFeePaise + p.earlyGstPaise)}` : "—"}</td>
                <td style={{ textAlign: "right" }} className="small">{p.duesPaise ? `− ${formatINR(p.duesPaise)}` : "—"}</td><td style={{ textAlign: "right" }} className="small b">{p.shipments.length ? formatINR(p.netPaise) : "—"}</td>
                <td className="small">{p.bank ? <>{p.bank.holderName}<div className="tiny muted mono">••••{p.bank.last4} · {p.bank.ifsc}</div></> : p.shipments.length ? <details><summary className="t-debit tiny">No bank account — add</summary><AdminOpForm op="payout_account_set" submit="Save bank" disabled={!termsWrite} fields={[{ name: "orgId", label: "", type: "hidden", value: p.orgId }, { name: "holderName", label: "Account holder" }, { name: "accountNumber", label: "Account number" }, { name: "ifsc", label: "IFSC" }, { name: "bankName", label: "Bank" }]} /></details> : <span className="tiny muted">{p.blocked}</span>}</td></tr>
            ))}</tbody></table></div>
        )}
      </section>
      <section className="card p0 mb16">
        <h2 className="b small card-h" style={{ margin: 0 }}>Manual payout (without the courier&apos;s COD record)</h2>
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
        <div className="row between" style={{ padding: "12px 16px", alignItems: "end", gap: 8, flexWrap: "wrap" }}>
          <h2 className="b small" style={{ margin: 0 }}>3 · Payouts</h2>
          {scheduled.length > 0 && remit && <div className="row wrap" style={{ gap: 8, alignItems: "end" }}>
            <a className="btn btn-sm btn-navy" href={`/api/admin/cod/bank-file?ids=${scheduled.map((b) => b.r.id).join(",")}`}>Download bank file · {scheduled.length} · {formatINR(scheduled.reduce((t, b) => t + b.r.netPaise, 0))}</a>
            <AdminOpForm op="cod_paid_all" submit="Mark all paid" confirmText={`Mark all ${scheduled.length} scheduled payouts paid with this reference?`} fields={[{ name: "ids", label: "", type: "hidden", value: scheduled.map((b) => b.r.id).join(",") }, { name: "reference", label: "Bank batch ref / UTR", placeholder: "UTR" }]} />
          </div>}
        </div>
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
