import { desc, eq } from "drizzle-orm";
import { AdminOpForm } from "@/components/admin/AdminOpForm";
import { formatINR } from "@/lib/money";
import { can } from "@/server/auth/rbac";
import { requireStaff } from "@/server/auth/session";
import { COMPANY_DEFAULT } from "@/server/billing";
import { getDb, schema } from "@/server/db/client";
import { getSetting } from "@/server/quotes/service";

const KIND: Record<string, string> = { invoice: "Invoice", credit_note: "Credit note", debit_note: "Debit note" };

export default async function AdminBillingDocuments() {
  const s = await requireStaff("finance.read");
  const write = can(s.role, "finance.adjust");
  const db = await getDb();
  const orgs = await db.select({ id: schema.orgs.id, name: schema.orgs.businessName }).from(schema.orgs).orderBy(schema.orgs.businessName);
  const docs = await db.select({ d: schema.billingDocuments, name: schema.orgs.businessName }).from(schema.billingDocuments).innerJoin(schema.orgs, eq(schema.orgs.id, schema.billingDocuments.orgId)).orderBy(desc(schema.billingDocuments.createdAt)).limit(100);
  const co = (await getSetting("company_billing", COMPANY_DEFAULT)).value;
  const orgOpts = orgs.map((o) => [o.id, o.name] as [string, string]);
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);
  const last = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0, 10);
  return (
    <>
      <div className="page-h"><div><h1>Invoices &amp; Notes</h1><p className="small muted" style={{ margin: "4px 0 0" }}>Tax invoices for shipping charges, and credit / debit notes. Customers see and print them in Billing.</p></div></div>
      <div className="split" style={{ gap: 16, alignItems: "start" }}>
        <section className="card" style={{ padding: 16 }}>
          <h2 className="b" style={{ fontSize: 15, marginTop: 0 }}>Generate invoice</h2>
          <AdminOpForm op="invoice_generate" submit="Generate" disabled={!write} fields={[{ name: "orgId", label: "Customer", type: "select", options: orgOpts }, { name: "from", label: "From", type: "date", value: first }, { name: "to", label: "To", type: "date", value: last }]} />
          <p className="tiny muted mt8">One line per charge of every confirmed shipment booked in the period (freight, fuel, COD fee …), RTO charges and non-shipment services (notification credits, Online Store plan / fees) charged in the period. Anything already on an invoice is skipped, and periods cannot overlap. CGST/SGST/IGST is fixed at issue from the company and customer GSTINs.</p>
          <h2 className="b mt16" style={{ fontSize: 15 }}>Issue credit / debit note</h2>
          <AdminOpForm op="note_issue" submit="Issue note" disabled={!write} fields={[
            { name: "orgId", label: "Customer", type: "select", options: orgOpts }, { name: "kind", label: "Type", type: "select", options: [["credit_note", "Credit note"], ["debit_note", "Debit note"]] },
            { name: "amount", label: "Amount incl. GST (₹)", type: "number", step: "0.01" }, { name: "refType", label: "Related to", type: "select", options: [["shipment", "Shipment"], ["invoice", "Invoice"], ["dispute", "Weight dispute"], ["other", "Other"]] },
            { name: "refId", label: "Reference (AWB / invoice no.)" }, { name: "reason", label: "Reason (shown to customer)", type: "textarea" },
            { name: "postToWallet", label: "Also post this amount to the customer’s wallet", type: "checkbox", wide: true },
          ]} />
          <p className="tiny muted mt8">Leave “post to wallet” off when the wallet was already adjusted (e.g. a weight charge already debited).</p>
        </section>
        <section className="card" style={{ padding: 16 }}>
          <h2 className="b" style={{ fontSize: 15, marginTop: 0 }}>Vishwaship company details (printed on documents)</h2>
          <AdminOpForm op="company_billing" submit="Save details" disabled={!write} fields={[
            { name: "legalName", label: "Legal name", value: co.legalName, wide: true }, { name: "gstin", label: "GSTIN", value: co.gstin }, { name: "stateCode", label: "State code", value: co.stateCode },
            { name: "email", label: "Billing email", type: "email", value: co.email }, { name: "sac", label: "SAC", value: co.sac }, { name: "address", label: "Registered address", type: "textarea", value: co.address },
          ]} />
        </section>
      </div>
      <section className="card p0 mt16">
        <h2 className="b small card-h" style={{ margin: 0 }}>Recent documents</h2>
        {docs.length === 0 ? <p className="small muted" style={{ padding: 16 }}>None issued yet.</p> : (
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Date</th><th>Number</th><th>Type</th><th>Customer</th><th>Reason / period</th><th style={{ textAlign: "right" }}>Total</th></tr></thead>
            <tbody>{docs.map(({ d, name }) => <tr key={d.id}><td className="small">{d.docDate.toLocaleDateString("en-IN")}</td><td className="small mono">{d.number}</td><td className="small">{KIND[d.kind]}</td><td className="small">{name}</td><td className="small">{d.reason ?? `${d.periodFrom?.toLocaleDateString("en-IN")} – ${d.periodTo?.toLocaleDateString("en-IN")}`}</td><td style={{ textAlign: "right" }} className="small b">{formatINR(d.totalPaise)}</td></tr>)}</tbody></table></div>
        )}
      </section>
    </>
  );
}
