import Link from "next/link";
import { Download } from "lucide-react";
import { AdminOpForm } from "@/components/admin/AdminOpForm";
import { GstUpload } from "@/components/admin/GstUpload";
import { formatINR } from "@/lib/money";
import { PRESETS, istFrom, istTo, presetRange, stateName, type PresetKey } from "@/lib/gst";
import { can } from "@/server/auth/rbac";
import { requireStaff } from "@/server/auth/session";
import { outward } from "@/server/gst/admin";
import { awbReconciliation, billBalances, supplierSummary, unmatched } from "@/server/gst/courier";
import { getDb, schema } from "@/server/db/client";
import { desc, gte, lte, and } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Finance & GST — Vishwaship Admin" };

type SP = Promise<{ tab?: string; preset?: string; from?: string; to?: string; q?: string }>;
const TABS = [
  { key: "outward", label: "Customer Billing / Outward" }, { key: "purchases", label: "Courier Purchases / Input GST" }, { key: "payments", label: "Courier Payments" },
  { key: "recon", label: "AWB Reconciliation" }, { key: "unmatched", label: "Unmatched" }, { key: "exports", label: "GST Exports" },
] as const;
const R = { textAlign: "right" as const };
const d = (x: Date | null | undefined) => (x ? x.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }) : "—");
const KIND: Record<string, string> = { invoice: "Invoice", credit_note: "Credit note", debit_note: "Debit note" };
const neg = (kind: string) => (kind === "credit_note" ? "−" : "");

export default async function FinanceGst({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const s = await requireStaff("finance.read");
  const costs = can(s.role, "shipments.cost.read"), write = costs && can(s.role, "finance.adjust");
  const tabs = TABS.filter((t) => t.key === "outward" || t.key === "exports" || costs);
  const tab = tabs.find((t) => t.key === sp.tab)?.key ?? "outward";
  const preset = (PRESETS.some((p) => p.key === sp.preset) ? sp.preset : "this_month") as PresetKey;
  const r = presetRange(preset, new Date(), { from: sp.from, to: sp.to });
  const from = istFrom(r.from), to = istTo(r.to);
  const q = sp.q?.trim().slice(0, 60) || undefined;
  const link = (over: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries({ tab, preset, from: preset === "custom" ? r.from : undefined, to: preset === "custom" ? r.to : undefined, q, ...over })) if (v) u.set(k, v);
    return `?${u}`;
  };
  const exp = (kind: string) => `/api/admin/gst?export=${kind}&from=${r.from}&to=${r.to}`;

  return (
    <>
      <div className="page-h"><div><h1>Finance &amp; GST</h1><p className="small muted" style={{ margin: "4px 0 0" }}>Output GST on Vishwaship invoices, input GST on courier bills, payments to couriers and AWB-level reconciliation.</p></div></div>
      <nav className="gst-presets mb12" aria-label="Finance & GST sections">{tabs.map((t) => <Link key={t.key} href={link({ tab: t.key })} className={`chip${t.key === tab ? " on" : ""}`}>{t.label}</Link>)}</nav>
      <form className="card mb12 gst-filter" method="get">
        <div className="gst-presets" role="group" aria-label="Period">{PRESETS.map((p) => <Link key={p.key} href={link({ preset: p.key, from: undefined, to: undefined })} className={`chip${p.key === preset ? " on" : ""}`}>{p.label}</Link>)}</div>
        <div className="row wrap" style={{ gap: 8, alignItems: "flex-end" }}>
          <input type="hidden" name="tab" value={tab} /><input type="hidden" name="preset" value="custom" />
          <label className="field" style={{ margin: 0 }}><span className="tiny muted">From</span><input className="input" type="date" name="from" defaultValue={r.from} /></label>
          <label className="field" style={{ margin: 0 }}><span className="tiny muted">To</span><input className="input" type="date" name="to" defaultValue={r.to} /></label>
          {(tab === "outward" || tab === "recon") && <label className="field grow" style={{ margin: 0, minWidth: 200 }}><span className="tiny muted">{tab === "recon" ? "AWB" : "Customer or document number"}</span><input className="input" name="q" defaultValue={q ?? ""} /></label>}
          <button className="btn btn-navy">Apply</button>
        </div>
        <p className="tiny muted" style={{ margin: 0 }}>{r.label}: {d(from)} – {d(to)} · India time</p>
      </form>
      {tab === "outward" && <Outward from={from} to={to} q={q} exp={exp("outward")} />}
      {tab === "purchases" && <Purchases from={from} to={to} write={write} exp={exp("purchases")} />}
      {tab === "payments" && <Payments from={from} to={to} write={write} />}
      {tab === "recon" && <Recon from={from} to={to} q={q} exp={exp("recon")} />}
      {tab === "unmatched" && <Unmatched write={write} />}
      {tab === "exports" && (
        <section className="card" style={{ padding: 16 }}>
          <h2 className="b" style={{ fontSize: 15, marginTop: 0 }}>Exports for Vishwaship&apos;s CA · {d(from)} – {d(to)}</h2>
          <div className="row wrap" style={{ gap: 8 }}>
            <a className="btn btn-outline" href={exp("outward")}><Download size={15} aria-hidden /> Outward supplies register (GSTR-1)</a>
            {costs && <a className="btn btn-outline" href={exp("purchases")}><Download size={15} aria-hidden /> Courier purchase register (for GSTR-2B)</a>}
            {costs && <a className="btn btn-outline" href={exp("recon")}><Download size={15} aria-hidden /> AWB reconciliation</a>}
          </div>
          <p className="tiny muted mt8">Output GST, input GST charged by couriers and ITC are separate figures. ITC is shown as &quot;pending review&quot; until your CA marks it, and GSTR-2B as &quot;not checked&quot; because no GST portal data is imported.</p>
        </section>
      )}
    </>
  );
}

async function Outward({ from, to, q, exp }: { from: Date; to: Date; q?: string; exp: string }) {
  const o = await outward(from, to, { q });
  const t = o.totals;
  return (
    <>
      {o.companyGstinMissing && <p className="note small mb12">Vishwaship&apos;s GSTIN is not set in Admin → Invoices &amp; Notes → company details. Documents will show the supplier GSTIN as missing and IGST is used until a state is known.</p>}
      <section className="gst-cards mb12">
        <div className="card gst-card"><span className="tiny muted">Taxable value (net of notes)</span><b>{formatINR(t.taxablePaise)}</b><span className="tiny">{o.docs.length} documents</span></div>
        <div className="card gst-card hl"><span className="tiny muted">Output GST</span><b>{formatINR(t.gstPaise)}</b><span className="tiny">CGST {formatINR(t.cgstPaise)} · SGST {formatINR(t.sgstPaise)}{t.utgstPaise ? ` · UTGST ${formatINR(t.utgstPaise)}` : ""} · IGST {formatINR(t.igstPaise)}</span></div>
        <div className="card gst-card"><span className="tiny muted">Collections · recharges credited</span><b>{formatINR(o.collectionsPaise)}</b><span className="tiny">{o.collections} payments</span></div>
      </section>
      <div className="row between mb8"><span className="tiny muted">{o.derived ? "Some older documents show a derived GST split (issued before GST snapshots)." : ""}</span><a className="btn btn-sm btn-outline" href={exp}><Download size={14} aria-hidden /> Export</a></div>
      <div className="card p0 tbl-wrap"><table className="tbl">
        <thead><tr><th>Type</th><th>Number</th><th>Date</th><th>Customer</th><th>GSTIN</th><th>POS</th><th style={R}>Taxable</th><th style={R}>CGST</th><th style={R}>SGST/UTGST</th><th style={R}>IGST</th><th style={R}>Total</th></tr></thead>
        <tbody>{o.docs.slice(0, 500).map((x) => (
          <tr key={x.id}><td className="small">{KIND[x.kind]}</td><td className="small mono b nw">{x.number}</td><td className="small nw">{d(x.docDate)}</td><td className="small">{x.customer}</td>
            <td className="small mono">{x.tax.recipientGstin ?? "Unregistered"}</td><td className="small">{x.tax.placeOfSupply ? `${x.tax.placeOfSupply} ${stateName(x.tax.placeOfSupply)}` : "—"}</td>
            <td style={R} className="small">{x.kind === "credit_note" ? "−" : ""}{formatINR(x.taxablePaise)}</td><td style={R} className="small">{neg(x.kind)}{formatINR(x.tax.cgstPaise)}</td><td style={R} className="small">{neg(x.kind)}{formatINR(x.tax.sgstPaise + x.tax.utgstPaise)}</td><td style={R} className="small">{neg(x.kind)}{formatINR(x.tax.igstPaise)}</td>
            <td style={R} className="small b">{x.kind === "credit_note" ? "−" : ""}{formatINR(x.totalPaise)}</td></tr>
        ))}{o.docs.length === 0 && <tr><td colSpan={11} className="muted small">No documents in this period.</td></tr>}</tbody>
      </table></div>
    </>
  );
}

async function Purchases({ from, to, write, exp }: { from: Date; to: Date; write: boolean; exp: string }) {
  const [bills, sup] = await Promise.all([billBalances(undefined, from, to), supplierSummary(from, to)]);
  return (
    <>
      <section className="card p0 tbl-wrap mb12"><table className="tbl">
        <thead><tr><th>Courier / supplier</th><th>GSTIN</th><th style={R}>Taxable (net)</th><th style={R}>GST charged</th><th style={R}>Gross</th><th style={R}>Paid</th><th style={R}>GST in paid*</th><th style={R}>Outstanding</th></tr></thead>
        <tbody>{sup.map((x) => (
          <tr key={x.supplierName}><td className="small b">{x.supplierName}</td><td className="small mono">{x.gstins.join(", ") || <span className="t-debit">missing</span>}</td><td style={R} className="small">{formatINR(x.taxablePaise)}</td>
            <td style={R} className="small">{formatINR(x.gstPaise)}</td><td style={R} className="small">{formatINR(x.grossPaise)}</td><td style={R} className="small">{formatINR(x.paidPaise)}{x.unallocatedPaise ? <div className="tiny muted">{formatINR(x.unallocatedPaise)} unallocated</div> : null}</td>
            <td style={R} className="small">{formatINR(x.gstInPaidPaise)}</td><td style={R} className="small b">{formatINR(x.outstandingPaise)}</td></tr>
        ))}{sup.length === 0 && <tr><td colSpan={8} className="small muted">No courier bills in this period yet.</td></tr>}</tbody>
      </table></section>
      <p className="tiny muted mb12">* GST inside the amount paid is shown only for payments allocated to a bill (in proportion to that bill&apos;s GST). Input tax credit stays &quot;pending review&quot; until your CA reviews it.</p>
      {write && (
        <div className="split mb12" style={{ gap: 12, alignItems: "start" }}>
          <section className="card" style={{ padding: 14 }}>
            <h2 className="b" style={{ fontSize: 15, marginTop: 0 }}>Record a courier bill / note</h2>
            <AdminOpForm op="bill_add" endpoint="/api/admin/gst" submit="Record" fields={[
              { name: "kind", label: "Type", type: "select", options: [["invoice", "Invoice"], ["credit_note", "Credit note"], ["debit_note", "Debit note"]] },
              { name: "supplierName", label: "Courier / supplier", placeholder: "Delhivery Ltd" }, { name: "supplierGstin", label: "Supplier GSTIN" }, { name: "billedGstin", label: "Vishwaship GSTIN billed" },
              { name: "number", label: "Document number" }, { name: "docDate", label: "Date", type: "date" }, { name: "originalNumber", label: "Original invoice (for notes)" }, { name: "placeOfSupply", label: "Place of supply (state code)", placeholder: "07" },
              { name: "taxable", label: "Taxable ₹", type: "number", step: "0.01" }, { name: "cgst", label: "CGST ₹", type: "number", step: "0.01", value: 0 }, { name: "sgst", label: "SGST ₹", type: "number", step: "0.01", value: 0 },
              { name: "utgst", label: "UTGST ₹", type: "number", step: "0.01", value: 0 }, { name: "igst", label: "IGST ₹", type: "number", step: "0.01", value: 0 },
              { name: "awb", label: "AWB (optional, whole bill for one AWB)" }, { name: "chargeType", label: "Charge type", type: "select", options: [["forward", "Forward"], ["rto", "RTO"], ["reverse", "Reverse"], ["weight", "Weight"], ["cod", "COD"], ["fuel", "Fuel"], ["other", "Other"]] },
              { name: "notes", label: "Notes", type: "textarea" },
            ]} />
          </section>
          <section className="card" style={{ padding: 14 }}>
            <h2 className="b" style={{ fontSize: 15, marginTop: 0 }}>Import bills with AWB annexure</h2>
            <p className="small muted">CSV or Excel, one row per AWB line; document columns repeat on every row. The same supplier + document number is never imported twice.</p>
            <p><a className="btn btn-sm btn-outline" href="/api/admin/gst?template=csv"><Download size={14} aria-hidden /> Template (CSV)</a></p>
            <GstUpload mode="import" label="Import file" accept=".csv,.xlsx" />
          </section>
        </div>
      )}
      <div className="row between mb8"><b className="small">Bills &amp; notes in this period</b><a className="btn btn-sm btn-outline" href={exp}><Download size={14} aria-hidden /> Purchase register</a></div>
      <div className="card p0 tbl-wrap"><table className="tbl">
        <thead><tr><th>Supplier</th><th>Type</th><th>Number</th><th>Date</th><th>GST period</th><th style={R}>Taxable</th><th style={R}>GST</th><th style={R}>Gross</th><th style={R}>Paid</th><th style={R}>Outstanding</th><th>ITC review</th><th>Original</th></tr></thead>
        <tbody>{bills.map((b) => (
          <tr key={b.id}>
            <td className="small">{b.supplierName}<div className="tiny mono muted">{b.supplierGstin ?? "GSTIN missing"}</div></td><td className="small">{KIND[b.kind]}</td><td className="small mono b nw">{b.number}</td><td className="small nw">{d(b.docDate)}</td><td className="small">{b.taxPeriod}</td>
            <td style={R} className="small">{formatINR(b.taxablePaise)}</td><td style={R} className="small">{formatINR(b.gstPaise)}</td><td style={R} className="small">{formatINR(b.totalPaise)}</td>
            <td style={R} className="small">{b.kind === "invoice" ? formatINR(b.paidPaise) : "—"}</td><td style={R} className="small b">{b.kind === "invoice" ? formatINR(b.outstandingPaise) : "—"}</td>
            <td className="small">{write ? <AdminOpForm op="itc_status" endpoint="/api/admin/gst" submit="Save" extra={{ billId: b.id }} fields={[{ name: "status", label: "", type: "select", value: b.itcStatus, options: [["pending_review", "Pending review"], ["eligible", "Eligible"], ["ineligible", "Ineligible"], ["blocked", "Blocked"]] }]} /> : b.itcStatus.replace("_", " ")}</td>
            <td className="small">{b.fileKey ? <a className="link" href={`/api/admin/gst/file/${b.id}`} target="_blank" rel="noreferrer">View</a> : write ? <GstUpload mode="pdf" billId={b.id} label="Attach" accept=".pdf,.png,.jpg,.jpeg" /> : "—"}</td>
          </tr>
        ))}{bills.length === 0 && <tr><td colSpan={12} className="small muted">No courier bills recorded for this period.</td></tr>}</tbody>
      </table></div>
    </>
  );
}

async function Payments({ from, to, write }: { from: Date; to: Date; write: boolean }) {
  const db = await getDb();
  const pays = await db.select().from(schema.courierPayments).where(and(gte(schema.courierPayments.paidAt, from), lte(schema.courierPayments.paidAt, to))).orderBy(desc(schema.courierPayments.paidAt)).limit(1000);
  const sup = await supplierSummary();
  return (
    <>
      {write && (
        <section className="card mb12" style={{ padding: 14 }}>
          <h2 className="b" style={{ fontSize: 15, marginTop: 0 }}>Record a payment to a courier</h2>
          <AdminOpForm op="payment_add" endpoint="/api/admin/gst" submit="Record payment" fields={[
            { name: "supplierName", label: "Courier / supplier", placeholder: "Delhivery Ltd" }, { name: "amount", label: "Amount paid ₹", type: "number", step: "0.01" }, { name: "paidAt", label: "Payment date", type: "date" },
            { name: "reference", label: "UTR / reference" }, { name: "method", label: "Method", placeholder: "NEFT" }, { name: "billNumber", label: "Settles invoice no. (optional)" }, { name: "allocate", label: "Amount for that invoice ₹", type: "number", step: "0.01", value: 0 },
            { name: "notes", label: "Notes", type: "textarea" },
          ]} />
          <p className="tiny muted mt8">Allocate only what the settlement statement says. Anything not allocated stays as an unallocated payment.</p>
        </section>
      )}
      <div className="card p0 tbl-wrap mb12"><table className="tbl">
        <thead><tr><th>Courier / supplier</th><th style={R}>GST charged (all time)</th><th style={R}>Paid (all time)</th><th style={R}>Unallocated</th><th style={R}>Outstanding</th></tr></thead>
        <tbody>{sup.map((x) => <tr key={x.supplierName}><td className="small b">{x.supplierName}</td><td style={R} className="small">{formatINR(x.gstPaise)}</td><td style={R} className="small">{formatINR(x.paidPaise)}</td><td style={R} className="small">{formatINR(x.unallocatedPaise)}</td><td style={R} className="small b">{formatINR(x.outstandingPaise)}</td></tr>)}</tbody>
      </table></div>
      <div className="card p0 tbl-wrap"><table className="tbl">
        <thead><tr><th>Date</th><th>Supplier</th><th>Reference</th><th>Method</th><th style={R}>Amount</th><th>Notes</th></tr></thead>
        <tbody>{pays.map((p) => <tr key={p.id}><td className="small nw">{d(p.paidAt)}</td><td className="small">{p.supplierName}</td><td className="small mono">{p.reference}</td><td className="small">{p.method ?? "—"}</td><td style={R} className="small b">{formatINR(p.amountPaise)}</td><td className="small">{p.notes ?? ""}</td></tr>)}
          {pays.length === 0 && <tr><td colSpan={6} className="small muted">No payments in this period.</td></tr>}</tbody>
      </table></div>
    </>
  );
}

async function Recon({ from, to, q, exp }: { from: Date; to: Date; q?: string; exp: string }) {
  const rows = await awbReconciliation(from, to, q);
  const MATCH: Record<string, string> = { matched: "Matched", no_courier_bill: "No courier bill yet", not_billed_to_customer: "Not billed to customer" };
  return (
    <>
      <div className="row between mb8"><span className="tiny muted">Before-GST difference = customer taxable billing − courier taxable cost. GST is shown separately.</span><a className="btn btn-sm btn-outline" href={exp}><Download size={14} aria-hidden /> Export</a></div>
      <div className="card p0 tbl-wrap"><table className="tbl">
        <thead><tr><th>AWB</th><th>Customer</th><th>Courier</th><th style={R}>Customer taxable</th><th style={R}>Customer GST</th><th style={R}>Courier taxable</th><th style={R}>Courier GST</th><th style={R}>Difference before GST</th><th>Status</th></tr></thead>
        <tbody>{rows.slice(0, 500).map((x) => (
          <tr key={x.id}><td className="small mono b nw">{x.awb ?? x.id}</td><td className="small">{x.business}</td><td className="small">{x.carrier}</td>
            <td style={R} className="small">{formatINR(x.custTaxable)}</td><td style={R} className="small">{formatINR(x.custGst)}</td><td style={R} className="small">{formatINR(x.courierTaxable)}</td><td style={R} className="small">{formatINR(x.courierGst)}</td>
            <td style={R} className={`small b ${x.differencePaise < 0 ? "t-debit" : ""}`}>{formatINR(x.differencePaise)}</td><td className="small">{MATCH[x.match]}{x.cells.length > 1 ? <div className="tiny muted">{x.cells.map((c) => c.type).join(", ")}</div> : null}</td></tr>
        ))}{rows.length === 0 && <tr><td colSpan={9} className="small muted">No shipments in this period.</td></tr>}</tbody>
      </table></div>
      {rows.length > 500 && <p className="tiny muted">Showing 500 of {rows.length}; the export has all.</p>}
    </>
  );
}

async function Unmatched({ write }: { write: boolean }) {
  const u = await unmatched();
  return (
    <>
      {write && <div className="mb12"><AdminOpForm op="rematch" endpoint="/api/admin/gst" submit="Re-check AWBs against shipments" fields={[]} /></div>}
      <h2 className="b" style={{ fontSize: 15 }}>Courier lines without a matching shipment ({u.lines.length})</h2>
      <div className="card p0 tbl-wrap mb12"><table className="tbl">
        <thead><tr><th>Supplier</th><th>Bill</th><th>AWB</th><th>Charge</th><th style={R}>Taxable</th><th style={R}>GST</th><th>Reason</th><th /></tr></thead>
        <tbody>{u.lines.map(({ l, b }) => (
          <tr key={l.id}><td className="small">{b.supplierName}</td><td className="small mono">{b.number}</td><td className="small mono">{l.awb ?? "—"}</td><td className="small">{l.chargeType}</td>
            <td style={R} className="small">{formatINR(l.taxablePaise)}</td><td style={R} className="small">{formatINR(l.gstPaise)}</td><td className="small">{l.note ?? ""}</td>
            <td>{write && <AdminOpForm op="resolve" endpoint="/api/admin/gst" submit="Mark reviewed" extra={{ lineId: l.id }} fields={[{ name: "note", label: "", placeholder: "What was found" }]} />}</td></tr>
        ))}{u.lines.length === 0 && <tr><td colSpan={8} className="small muted">Nothing unmatched.</td></tr>}</tbody>
      </table></div>
      <h2 className="b" style={{ fontSize: 15 }}>Courier bills without a supplier GSTIN ({u.noGstin.length})</h2>
      <div className="card p0 tbl-wrap"><table className="tbl">
        <thead><tr><th>Supplier</th><th>Type</th><th>Number</th><th>Date</th><th style={R}>GST</th></tr></thead>
        <tbody>{u.noGstin.map((b) => <tr key={b.id}><td className="small">{b.supplierName}</td><td className="small">{KIND[b.kind]}</td><td className="small mono">{b.number}</td><td className="small">{d(b.docDate)}</td><td style={R} className="small">{formatINR(b.cgstPaise + b.sgstPaise + b.utgstPaise + b.igstPaise)}</td></tr>)}
          {u.noGstin.length === 0 && <tr><td colSpan={5} className="small muted">All bills have a GSTIN.</td></tr>}</tbody>
      </table></div>
    </>
  );
}
