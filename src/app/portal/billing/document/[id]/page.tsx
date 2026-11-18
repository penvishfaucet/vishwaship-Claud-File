import { BrandLogo } from "@/components/BrandLogo";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { formatINR } from "@/lib/money";
import { getDb, schema } from "@/server/db/client";
import { portalContext } from "@/server/portal/context";
import { getSetting } from "@/server/quotes/service";
import { PrintButton } from "@/components/PrintButton";
import { COMPANY_DEFAULT } from "@/server/billing";
import Link from "next/link";

/** Printable tax invoice / credit note / debit note. Only the owning account can open it. */
export default async function BillingDocument({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await portalContext();
  const db = await getDb();
  const [doc] = await db.select().from(schema.billingDocuments).where(and(eq(schema.billingDocuments.id, id), eq(schema.billingDocuments.orgId, ctx.org.id)));
  if (!doc) notFound();
  const co = (await getSetting("company_billing", COMPANY_DEFAULT)).value;
  const title = doc.kind === "invoice" ? "Tax Invoice" : doc.kind === "credit_note" ? "Credit Note" : "Debit Note";
  const lines = doc.lines as Array<{ description: string; ref?: string; taxablePaise: number; gstPaise: number }>;
  const d = (x: Date | null) => x?.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }) ?? "";
  return (
    <div className="doc-print">
      <div className="row between no-print mb12"><Link className="link-navy small" href={`/portal/billing/${doc.kind === "invoice" ? "invoices" : doc.kind === "credit_note" ? "credit-notes" : "debit-notes"}/`}>← Back</Link><PrintButton /></div>
      <article className="card doc" style={{ padding: 28 }}>
        <header className="row between" style={{ alignItems: "flex-start", gap: 16 }}>
          <div>
            <BrandLogo height={56} />
            <p className="small" style={{ margin: "8px 0 0", whiteSpace: "pre-line" }}><b>{co.legalName}</b>{co.address ? `\n${co.address}` : ""}{co.gstin ? `\nGSTIN: ${co.gstin}` : "\nGSTIN: (set by Vishwaship admin)"}{`\n${co.email}`}</p>
          </div>
          <div style={{ textAlign: "right" }}>
            <h1 style={{ margin: 0, fontSize: 22 }}>{title}</h1>
            <p className="small" style={{ margin: "6px 0 0" }}>No. <b className="mono">{doc.number}</b><br />Date: {d(doc.docDate)}{doc.periodFrom && <><br />Period: {d(doc.periodFrom)} – {d(doc.periodTo)}</>}</p>
          </div>
        </header>
        <section className="mt16 small">
          <b>Billed to</b><br />{ctx.org.businessName}{ctx.org.gstin ? <><br />GSTIN: {ctx.org.gstin}</> : null}
          {doc.reason && <p style={{ margin: "8px 0 0" }}><b>Reason:</b> {doc.reason}{doc.refType ? ` (${doc.refType} ${doc.refId ?? ""})` : ""}</p>}
        </section>
        <table className="tbl mt16">
          <thead><tr><th>#</th><th>Description</th><th>SAC</th><th style={{ textAlign: "right" }}>Taxable value</th><th style={{ textAlign: "right" }}>GST</th><th style={{ textAlign: "right" }}>Amount</th></tr></thead>
          <tbody>
            {(lines.length ? lines : [{ description: doc.reason ?? title, taxablePaise: doc.taxablePaise, gstPaise: doc.gstPaise }]).map((l, i) => (
              <tr key={i}><td className="small">{i + 1}</td><td className="small">{l.description}{"ref" in l && l.ref ? <div className="tiny muted mono">{l.ref}</div> : null}</td><td className="small">{co.sac}</td><td style={{ textAlign: "right" }} className="small">{formatINR(l.taxablePaise)}</td><td style={{ textAlign: "right" }} className="small">{formatINR(l.gstPaise)}</td><td style={{ textAlign: "right" }} className="small">{formatINR(l.taxablePaise + l.gstPaise)}</td></tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={3} className="b">Total</td><td style={{ textAlign: "right" }} className="b">{formatINR(doc.taxablePaise)}</td><td style={{ textAlign: "right" }} className="b">{formatINR(doc.gstPaise)}</td><td style={{ textAlign: "right" }} className="b">{formatINR(doc.totalPaise)}</td></tr>
          </tfoot>
        </table>
        <p className="tiny muted mt16">GST shown as IGST/CGST+SGST per place of supply on the filed return. This is a computer-generated document and does not need a signature.</p>
      </article>
    </div>
  );
}
