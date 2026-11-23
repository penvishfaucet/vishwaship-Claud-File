import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { gstinState, isGstin, placeOfSupply, splitGst, stateCodeOf, taxPeriodOf, type GstSplit } from "@/lib/gst";

/**
 * GST snapshot for a Vishwaship billing document (invoice / credit note / debit note), taken once at posting time.
 * Later edits to the company settings or the customer's GSTIN never change a posted document.
 */
export type Company = { legalName: string; gstin: string; address: string; stateCode: string; email: string; sac: string };
export const COMPANY_FALLBACK: Company = { legalName: "Vishwaship", gstin: "", address: "", stateCode: "", email: "support@vishwaship.com", sac: "996812" };

export async function companyTax(): Promise<Company & { state: string | null }> {
  const { getSetting } = await import("@/server/quotes/service");
  const c = { ...COMPANY_FALLBACK, ...(await getSetting<Partial<Company>>("company_billing", COMPANY_FALLBACK)).value };
  return { ...c, state: gstinState(c.gstin) ?? stateCodeOf(c.stateCode) };
}

export type DocLine = {
  description: string; ref?: string | null; taxablePaise: number; gstPaise: number;
  key?: string; chargeType?: string; awb?: string | null; shipmentId?: string | null; rateBps?: number;
} & Partial<GstSplit>;

type Org = Pick<typeof schema.orgs.$inferSelect, "businessName" | "gstin" | "address">;
export function recipientOf(org: Org) {
  const gstin = isGstin(org.gstin) ? org.gstin!.trim().toUpperCase() : null;
  const addr = (org.address ?? {}) as { state?: string };
  return { name: org.businessName, gstin, state: stateCodeOf(addr.state) };
}

/** Split every line, then total the parts (line-level rounding; the parts always add up to each line's GST). */
export function snapshotFrom(company: { gstin: string; state: string | null; sac: string }, org: Org, lines: DocLine[], docDate: Date) {
  const r = recipientOf(org);
  const pos = placeOfSupply({ recipientGstin: r.gstin, recipientState: r.state, supplierState: company.state });
  const out = lines.map((l) => ({ ...l, ...splitGst(l.gstPaise, company.state, pos) }));
  const sum = (k: keyof GstSplit) => out.reduce((t, l) => t + (l[k] ?? 0), 0);
  const rates = [...new Set(out.map((l) => l.rateBps).filter((x): x is number => typeof x === "number"))];
  return {
    lines: out,
    fields: {
      supplierGstin: isGstin(company.gstin) ? company.gstin.trim().toUpperCase() : null, supplierState: company.state,
      recipientName: r.name, recipientGstin: r.gstin, placeOfSupply: pos, sac: company.sac || "996812",
      rateBps: rates.length === 1 ? rates[0] : null,
      cgstPaise: sum("cgstPaise"), sgstPaise: sum("sgstPaise"), utgstPaise: sum("utgstPaise"), igstPaise: sum("igstPaise"),
      taxPeriod: taxPeriodOf(docDate), taxSnapshotAt: new Date(),
    },
  };
}

export async function snapshotFor(orgId: string, lines: DocLine[], docDate: Date) {
  const db = await getDb();
  const [org] = await db.select({ businessName: schema.orgs.businessName, gstin: schema.orgs.gstin, address: schema.orgs.address }).from(schema.orgs).where(eq(schema.orgs.id, orgId));
  return snapshotFrom(await companyTax(), org ?? { businessName: "", gstin: null, address: null }, lines, docDate);
}

/**
 * Read view of a document's GST: the posted snapshot, or — for documents issued before snapshots existed — the split
 * derived from today's company + customer details, marked derived so reports can say so.
 */
export type DocTax = GstSplit & { supplierGstin: string | null; recipientGstin: string | null; recipientName: string | null; placeOfSupply: string | null; sac: string; taxPeriod: string; derived: boolean };
export function docTax(doc: typeof schema.billingDocuments.$inferSelect, company: { gstin: string; state: string | null; sac: string }, org: Org): DocTax {
  if (doc.taxSnapshotAt) {
    return {
      cgstPaise: doc.cgstPaise ?? 0, sgstPaise: doc.sgstPaise ?? 0, utgstPaise: doc.utgstPaise ?? 0, igstPaise: doc.igstPaise ?? 0,
      supplierGstin: doc.supplierGstin, recipientGstin: doc.recipientGstin, recipientName: doc.recipientName, placeOfSupply: doc.placeOfSupply,
      sac: doc.sac ?? company.sac ?? "996812", taxPeriod: doc.taxPeriod ?? taxPeriodOf(doc.docDate), derived: false,
    };
  }
  const r = recipientOf(org);
  const pos = placeOfSupply({ recipientGstin: r.gstin, recipientState: r.state, supplierState: company.state });
  const lines = ((doc.lines as DocLine[] | null) ?? []);
  const parts = lines.length ? lines.map((l) => splitGst(l.gstPaise ?? 0, company.state, pos)) : [splitGst(doc.gstPaise, company.state, pos)];
  const sum = (k: keyof GstSplit) => parts.reduce((t, p) => t + p[k], 0);
  return {
    cgstPaise: sum("cgstPaise"), sgstPaise: sum("sgstPaise"), utgstPaise: sum("utgstPaise"), igstPaise: sum("igstPaise"),
    supplierGstin: isGstin(company.gstin) ? company.gstin.toUpperCase() : null, recipientGstin: r.gstin, recipientName: r.name, placeOfSupply: pos,
    sac: company.sac || "996812", taxPeriod: taxPeriodOf(doc.docDate), derived: true,
  };
}
