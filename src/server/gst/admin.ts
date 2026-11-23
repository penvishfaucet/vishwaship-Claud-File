import "server-only";
import { and, desc, eq, gte, ilike, inArray, lte, or } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { stateName, type GstSplit } from "@/lib/gst";
import { companyTax, docTax, type DocTax } from "./posting";
import { awbReconciliation, billBalances, supplierSummary } from "./courier";

/**
 * Admin → Finance & GST. Outward supplies = every Vishwaship invoice / note across customers (output GST);
 * collections = wallet recharges credited. Purchase-side figures live in courier.ts. Exports are .xlsx.
 */
export async function outward(from: Date, to: Date, f: { orgId?: string; gstin?: string; q?: string } = {}) {
  const db = await getDb();
  const conds = [gte(schema.billingDocuments.docDate, from), lte(schema.billingDocuments.docDate, to)];
  if (f.orgId) conds.push(eq(schema.billingDocuments.orgId, f.orgId));
  const q = f.q?.trim().replace(/[%_]/g, "").slice(0, 60);
  if (q) conds.push(or(ilike(schema.billingDocuments.number, `%${q}%`), ilike(schema.orgs.businessName, `%${q}%`))!);
  const rows = await db.select({ d: schema.billingDocuments, org: { businessName: schema.orgs.businessName, gstin: schema.orgs.gstin, address: schema.orgs.address } })
    .from(schema.billingDocuments).innerJoin(schema.orgs, eq(schema.orgs.id, schema.billingDocuments.orgId)).where(and(...conds)).orderBy(desc(schema.billingDocuments.docDate)).limit(5000);
  const company = await companyTax();
  let docs: Array<typeof schema.billingDocuments.$inferSelect & { tax: DocTax; customer: string }> = rows.map(({ d, org }) => ({ ...d, tax: docTax(d, company, org), customer: org.businessName }));
  if (f.gstin) docs = docs.filter((d) => (d.tax.recipientGstin ?? "") === f.gstin!.toUpperCase());
  const sign = (k: string) => (k === "credit_note" ? -1 : 1);
  const tot = docs.reduce((t, d) => ({
    taxablePaise: t.taxablePaise + sign(d.kind) * d.taxablePaise, gstPaise: t.gstPaise + sign(d.kind) * d.gstPaise, totalPaise: t.totalPaise + sign(d.kind) * d.totalPaise,
    cgstPaise: t.cgstPaise + sign(d.kind) * d.tax.cgstPaise, sgstPaise: t.sgstPaise + sign(d.kind) * d.tax.sgstPaise, utgstPaise: t.utgstPaise + sign(d.kind) * d.tax.utgstPaise, igstPaise: t.igstPaise + sign(d.kind) * d.tax.igstPaise,
  }), { taxablePaise: 0, gstPaise: 0, totalPaise: 0, cgstPaise: 0, sgstPaise: 0, utgstPaise: 0, igstPaise: 0 } as GstSplit & { taxablePaise: number; gstPaise: number; totalPaise: number });
  // collections: wallet recharges credited in the period (payment date)
  const wallets = f.orgId ? await db.select({ id: schema.wallets.id }).from(schema.wallets).where(eq(schema.wallets.orgId, f.orgId)) : null;
  const colConds = [eq(schema.ledgerEntries.kind, "recharge_credit"), gte(schema.ledgerEntries.createdAt, from), lte(schema.ledgerEntries.createdAt, to)];
  if (wallets) colConds.push(inArray(schema.ledgerEntries.walletId, wallets.length ? wallets.map((w) => w.id) : ["-"]));
  const col = await db.select({ a: schema.ledgerEntries.amountPaise }).from(schema.ledgerEntries).where(and(...colConds));
  return { docs, totals: tot, collectionsPaise: col.reduce((t, c) => t + c.a, 0), collections: col.length, companyGstinMissing: !company.gstin, derived: docs.some((d) => d.tax.derived) };
}

const R = (p: number) => Math.round(p) / 100;
const day = (d: Date | null) => (d ? new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10) : "");

async function book(sheets: Array<{ name: string; headers: string[]; rows: unknown[][] }>) {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Vishwaship";
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name.slice(0, 31));
    ws.addRow(s.headers).font = { bold: true };
    for (const r of s.rows) ws.addRow(r.map((v) => (typeof v === "string" && /^[=+\-@]/.test(v) ? `'${v}` : v ?? "")));
    ws.columns.forEach((c) => { c.width = 16; });
    ws.views = [{ state: "frozen", ySplit: 1 }];
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export async function exportOutward(from: Date, to: Date) {
  const o = await outward(from, to);
  return book([{
    name: "Outward supplies", headers: ["Type", "Number", "Date", "GST period", "Customer", "Recipient GSTIN", "Place of supply", "SAC", "Rate %", "Taxable", "CGST", "SGST", "UTGST", "IGST", "GST", "Gross", "Original doc", "Tax basis"],
    rows: o.docs.map((d) => {
      const s = d.kind === "credit_note" ? -1 : 1;
      return [d.kind, d.number, day(d.docDate), d.tax.taxPeriod, d.customer, d.tax.recipientGstin ?? "Unregistered", `${d.tax.placeOfSupply ?? ""} ${stateName(d.tax.placeOfSupply)}`.trim(), d.tax.sac, d.rateBps != null ? d.rateBps / 100 : "Mixed",
        s * R(d.taxablePaise), s * R(d.tax.cgstPaise), s * R(d.tax.sgstPaise), s * R(d.tax.utgstPaise), s * R(d.tax.igstPaise), s * R(d.gstPaise), s * R(d.totalPaise), d.originalDocId ?? "", d.tax.derived ? "Derived split" : "Posted snapshot"];
    }),
  }, { name: "Totals", headers: ["Item", "Amount (Rs.)"], rows: [["Taxable (net of notes)", R(o.totals.taxablePaise)], ["CGST", R(o.totals.cgstPaise)], ["SGST", R(o.totals.sgstPaise)], ["UTGST", R(o.totals.utgstPaise)], ["IGST", R(o.totals.igstPaise)], ["Output GST", R(o.totals.gstPaise)], ["Gross billed", R(o.totals.totalPaise)], ["Collections (recharges credited)", R(o.collectionsPaise)]] }]);
}

export async function exportPurchases(from: Date, to: Date) {
  const bills = await billBalances(undefined, from, to);
  const sup = await supplierSummary(from, to);
  const db = await getDb();
  const lines = bills.length ? await db.select().from(schema.courierBillLines).where(inArray(schema.courierBillLines.billId, bills.map((b) => b.id))) : [];
  return book([
    { name: "Courier purchase register", headers: ["Supplier", "Supplier GSTIN", "Billed GSTIN", "Type", "Number", "Date", "GST period", "Place of supply", "Taxable", "CGST", "SGST", "UTGST", "IGST", "GST", "Gross", "Paid (allocated)", "GST in paid (allocated)", "Outstanding", "ITC status (review)", "GSTR-2B"],
      rows: bills.map((b) => { const s = b.kind === "credit_note" ? -1 : 1; return [b.supplierName, b.supplierGstin ?? "MISSING", b.billedGstin ?? "", b.kind, b.number, day(b.docDate), b.taxPeriod, b.placeOfSupply ?? "", s * R(b.taxablePaise), s * R(b.cgstPaise), s * R(b.sgstPaise), s * R(b.utgstPaise), s * R(b.igstPaise), s * R(b.gstPaise), s * R(b.totalPaise), R(b.paidPaise), R(b.gstInPaidPaise), R(b.outstandingPaise), b.itcStatus, b.gstr2bStatus === "not_checked" ? "Not checked (no portal data)" : b.gstr2bStatus]; }) },
    { name: "AWB lines", headers: ["Bill number", "AWB", "Charge type", "Taxable", "GST", "Gross", "Match", "Note"], rows: lines.map((l) => [bills.find((b) => b.id === l.billId)?.number ?? "", l.awb ?? "", l.chargeType, R(l.taxablePaise), R(l.gstPaise), R(l.totalPaise), l.matchStatus, l.note ?? ""]) },
    { name: "By supplier", headers: ["Supplier", "GSTINs", "Documents", "Taxable (net)", "GST charged (net)", "Gross", "Paid", "Unallocated payments", "Outstanding", "GST in paid (allocated)"], rows: sup.map((s) => [s.supplierName, s.gstins.join(", "), s.documents, R(s.taxablePaise), R(s.gstPaise), R(s.grossPaise), R(s.paidPaise), R(s.unallocatedPaise), R(s.outstandingPaise), R(s.gstInPaidPaise)]) },
  ]);
}

export async function exportRecon(from: Date, to: Date) {
  const rows = await awbReconciliation(from, to);
  return book([{ name: "AWB reconciliation", headers: ["AWB", "Customer", "Courier", "Status", "Customer taxable", "Customer GST", "Courier taxable", "Courier GST", "Difference before GST", "Courier documents", "Match"],
    rows: rows.map((r) => [r.awb ?? r.id, r.business, r.carrier, r.status, R(r.custTaxable), R(r.custGst), R(r.courierTaxable), R(r.courierGst), R(r.differencePaise), r.courierDocs.join(", "), r.match]) }]);
}
