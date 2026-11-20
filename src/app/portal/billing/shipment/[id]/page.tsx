import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { and, eq, gte, lte } from "drizzle-orm";
import { BrandLogo } from "@/components/BrandLogo";
import { PrintButton } from "@/components/PrintButton";
import { formatINR } from "@/lib/money";
import { getDb, schema } from "@/server/db/client";
import { portalContext } from "@/server/portal/context";
import { getSetting } from "@/server/quotes/service";
import { COMPANY_DEFAULT } from "@/server/billing";

/**
 * Vishwaship GST invoice for one shipment (Orders → ⋯ → Vishwaship GST invoice).
 * GST tax invoices are issued per billing period and list every shipment by AWB, so a shipment is never
 * invoiced twice: when its period's tax invoice exists we open it; until then this page shows the shipment's
 * charge (taxable value + GST) and the period whose tax invoice will include it.
 */
export default async function ShipmentGstInvoice({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await portalContext();
  const db = await getDb();
  const [row] = await db.select({ s: schema.shipments, o: schema.orders }).from(schema.shipments)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.shipments.orderId))
    .where(and(eq(schema.shipments.id, id), eq(schema.shipments.orgId, ctx.org.id)));
  if (!row) notFound();
  const { s, o } = row;

  const docs = await db.select().from(schema.billingDocuments).where(and(eq(schema.billingDocuments.orgId, ctx.org.id), eq(schema.billingDocuments.kind, "invoice"),
    lte(schema.billingDocuments.periodFrom, s.createdAt), gte(schema.billingDocuments.periodTo, s.createdAt)));
  const refs = [s.awb, s.id].filter(Boolean);
  const doc = docs.find((d) => (d.lines as Array<{ ref?: string }>).some((l) => l.ref && refs.includes(l.ref))) ?? null;
  if (doc) redirect(`/portal/billing/document/${doc.id}/`);

  const co = (await getSetting("company_billing", COMPANY_DEFAULT)).value;
  const gstBps = (await getSetting<number>("gst_bps", 1800)).value;
  const total = s.sellPaise;
  const taxable = Math.round((total * 10_000) / (10_000 + gstBps));
  const cancelled = s.status === "cancelled" || s.bookingStatus === "cancelled";
  const d = (x: Date) => x.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });
  const month = s.createdAt.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", month: "long", year: "numeric" });
  const to = o.consignee as { name?: string; city?: string; state?: string; pincode?: string };

  return (
    <div className="doc-print">
      <div className="row between no-print mb12"><Link className="link-navy small" href="/portal/orders/">← Back to orders</Link><PrintButton /></div>
      <article className="card doc" style={{ padding: 28 }}>
        <header className="row between" style={{ alignItems: "flex-start", gap: 16 }}>
          <div>
            <BrandLogo height={56} />
            <p className="small" style={{ margin: "8px 0 0", whiteSpace: "pre-line" }}><b>{co.legalName}</b>{co.address ? `\n${co.address}` : ""}{co.gstin ? `\nGSTIN: ${co.gstin}` : ""}{`\n${co.email}`}</p>
          </div>
          <div style={{ textAlign: "right" }}>
            <h1 style={{ margin: 0, fontSize: 22 }}>Shipping charge statement</h1>
            <p className="small" style={{ margin: "6px 0 0" }}>AWB <b className="mono">{s.awb ?? "pending"}</b><br />Order {o.orderNumber}<br />Booked {d(s.createdAt)}</p>
          </div>
        </header>
        <p className="small mt16" role="note" style={{ background: "var(--orange-soft, #fff3ec)", padding: "10px 12px", borderRadius: 10 }}>
          {cancelled
            ? <>This shipment was cancelled, so it is not billed and will not appear on a GST tax invoice.</>
            : <>The GST tax invoice for this shipment is issued with your <b>{month}</b> tax invoice and will open here once it is issued. You can also find it under <Link className="link-navy" href="/portal/billing/invoices/">Billing → Invoices</Link>.</>}
        </p>
        <section className="mt16 small">
          <b>Billed to</b><br />{ctx.org.businessName}{ctx.org.gstin ? <><br />GSTIN: {ctx.org.gstin}</> : null}
        </section>
        <table className="tbl mt16">
          <thead><tr><th>Description</th><th>SAC</th><th style={{ textAlign: "right" }}>Taxable value</th><th style={{ textAlign: "right" }}>GST</th><th style={{ textAlign: "right" }}>Amount</th></tr></thead>
          <tbody>
            <tr>
              <td className="small">Shipping — {s.carrierName} {s.serviceName}<div className="tiny muted">{[to.name, to.city, to.state, to.pincode].filter(Boolean).join(", ")} · {(s.chargeableWeightGrams / 1000).toLocaleString("en-IN", { maximumFractionDigits: 2 })} kg chargeable</div></td>
              <td className="small">{co.sac}</td>
              <td style={{ textAlign: "right" }} className="small">{formatINR(taxable)}</td>
              <td style={{ textAlign: "right" }} className="small">{formatINR(total - taxable)}</td>
              <td style={{ textAlign: "right" }} className="small">{formatINR(total)}</td>
            </tr>
          </tbody>
        </table>
        <p className="tiny muted mt16">This statement is not a tax invoice. GST {(gstBps / 100).toFixed(0)}% shown as charged on the shipment; the tax invoice shows IGST / CGST + SGST per place of supply.</p>
      </article>
    </div>
  );
}
