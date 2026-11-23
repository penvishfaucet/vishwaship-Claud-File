import "server-only";
import { stateName } from "@/lib/gst";
import { zip } from "@/server/zip";
import { documentPdf } from "./pdf";
import { companyTax } from "./posting";
import { awbCharges, documents, summary, type AwbRow, type DocRow } from "./reports";

/**
 * "Vishwaship Purchase and GST Reconciliation Pack" for the customer's CA: one Excel workbook (summary, invoice
 * register, credit/debit note register, AWB-wise charges, non-shipment services) plus a PDF of every document,
 * zipped. Vishwaship's invoices are outward supplies for Vishwaship and purchases for the customer; GSTR-2B match
 * status is shown as "Not verified" because no GST portal data is imported, and ITC eligibility is left for the CA.
 */
const R = (p: number) => Math.round(p) / 100;
const day = (d: Date | null) => (d ? new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10) : "");
const KIND: Record<string, string> = { invoice: "Tax invoice", credit_note: "Credit note", debit_note: "Debit note" };

export async function workbook(orgId: string, from: Date, to: Date, title: string) {
  const ExcelJS = (await import("exceljs")).default;
  const [s, docs, awb] = await Promise.all([summary(orgId, from, to), documents(orgId, from, to), awbCharges(orgId, from, to, "all")]);
  const wb = new ExcelJS.Workbook();
  wb.creator = "Vishwaship";
  const sheet = (name: string, headers: string[], rows: unknown[][]) => {
    const ws = wb.addWorksheet(name);
    ws.addRow(headers).font = { bold: true };
    for (const r of rows) ws.addRow(r.map((v) => (typeof v === "string" && /^[=+\-@]/.test(v) ? `'${v}` : v ?? "")));
    ws.columns.forEach((c) => { c.width = 16; });
    ws.views = [{ state: "frozen", ySplit: 1 }];
    return ws;
  };
  const split = (x: { cgstPaise: number; sgstPaise: number; utgstPaise: number; igstPaise: number }) => [R(x.cgstPaise), R(x.sgstPaise), R(x.utgstPaise), R(x.igstPaise)];

  sheet("Summary", ["Item", "Taxable (Rs.)", "CGST", "SGST", "UTGST", "IGST", "GST total", "Gross (Rs.)", "Count / note"], [
    [title, "", "", "", "", "", "", "", `${day(from)} to ${day(to)} (India time). Document totals by document date.`],
    ["Tax invoices", R(s.invoices.taxablePaise), ...split(s.invoices.split), R(s.invoices.gstPaise), R(s.invoices.totalPaise), s.invoices.count],
    ["Debit notes", R(s.debitNotes.taxablePaise), ...split(s.debitNotes.split), R(s.debitNotes.gstPaise), R(s.debitNotes.totalPaise), s.debitNotes.count],
    ["Credit notes (less)", -R(s.creditNotes.taxablePaise), ...split(s.creditNotes.split).map((v) => -v), -R(s.creditNotes.gstPaise), -R(s.creditNotes.totalPaise), s.creditNotes.count],
    ["Net billed", R(s.net.taxablePaise), ...split(s.net.split), R(s.net.gstPaise), R(s.net.totalPaise), ""],
    [],
    ["Payments & wallet recharges (payment date)", "", "", "", "", "", "", R(s.payments.amountPaise), s.payments.count],
    ["Wallet balance at start", "", "", "", "", "", "", R(s.wallet.openingPaise), ""],
    ...s.wallet.used.map((g) => [`Used: ${g.label}`, "", "", "", "", "", "", -R(g.amountPaise), ""]),
    ...s.wallet.back.map((g) => [`Returned: ${g.label}`, "", "", "", "", "", "", R(g.amountPaise), ""]),
    ...(s.wallet.otherPaise ? [["Other wallet movements", "", "", "", "", "", "", R(s.wallet.otherPaise), ""]] : []),
    ["Unused wallet balance at end", "", "", "", "", "", "", R(s.wallet.closingPaise), ""],
    [],
    ["GSTR-2B match status", "", "", "", "", "", "", "", "Not verified — no GST portal data imported. Match the invoice register with your GSTR-2B."],
    ["ITC eligibility", "", "", "", "", "", "", "", "For your CA to review."],
    ...(s.derived ? [["Note", "", "", "", "", "", "", "", "Some older documents were issued before GST snapshots: their CGST/SGST/IGST split is derived from current GSTIN details."]] : []),
  ]);

  const docRow = (d: DocRow) => [
    KIND[d.kind] ?? d.kind, d.number, day(d.docDate), d.tax.taxPeriod, d.originalNumber ?? "", d.tax.supplierGstin ?? "", "Vishwaship",
    d.tax.recipientGstin ?? "Unregistered", d.tax.recipientName ?? "", `${d.tax.placeOfSupply ?? ""} ${stateName(d.tax.placeOfSupply)}`.trim(), d.tax.sac,
    d.rateBps != null ? d.rateBps / 100 : "Mixed", R(d.taxablePaise), ...split(d.tax), R(d.gstPaise), R(d.totalPaise), d.reason ?? "", d.tax.derived ? "Derived split" : "Posted snapshot", "Not verified", "For CA review",
  ];
  const docHead = ["Type", "Number", "Date", "GST period", "Original invoice", "Supplier GSTIN", "Supplier", "Recipient GSTIN", "Recipient", "Place of supply", "SAC", "Rate %", "Taxable", "CGST", "SGST", "UTGST", "IGST", "GST total", "Gross", "Reason", "Tax basis", "GSTR-2B status", "ITC"];
  sheet("Invoice Register", docHead, docs.filter((d) => d.kind === "invoice").map(docRow));
  sheet("Credit-Debit Notes", docHead, docs.filter((d) => d.kind !== "invoice").map(docRow));

  const awbRow = (r: AwbRow) => [
    r.awb, r.orderNumber, r.courier, r.status, day(r.bookedAt), day(r.deliveredAt), r.chargeLabel, r.description, R(r.taxablePaise), r.rateBps != null ? r.rateBps / 100 : "",
    ...split(r.split), R(r.gstPaise), R(r.grossPaise), r.document ?? "Not invoiced yet", day(r.documentDate), R(r.codValuePaise), r.codRemittance,
  ];
  const awbHead = ["AWB", "Order", "Courier", "Status", "Booked", "Delivered", "Charge type", "Description", "Taxable", "Rate %", "CGST", "SGST", "UTGST", "IGST", "GST total", "Gross", "Document", "Document date", "COD order value (not a fee)", "COD remittance"];
  sheet("AWB Charges", awbHead, awb.rows.map(awbRow));
  sheet("Non-shipment Services", awbHead, awb.nonShipment.map(awbRow));
  return { buffer: Buffer.from(await wb.xlsx.writeBuffer()), docs, summary: s, truncated: awb.truncated };
}

export async function caPack(orgId: string, from: Date, to: Date) {
  const title = "Vishwaship Purchase and GST Reconciliation Pack";
  const company = await companyTax();
  const { buffer, docs, truncated } = await workbook(orgId, from, to, title);
  const folder = `Vishwaship_GST_Pack_${day(from)}_to_${day(to)}`;
  const files: Array<{ name: string; data: Buffer | Uint8Array | string }> = [{ name: `${folder}/GST_Registers_${day(from)}_${day(to)}.xlsx`, data: buffer }];
  for (const d of docs) files.push({ name: `${folder}/documents/${d.number.replace(/[\\/:*?"<>|]+/g, "-")}.pdf`, data: await documentPdf(d, company) });
  files.push({ name: `${folder}/README.txt`, data: [
    title, `Period: ${day(from)} to ${day(to)} (India time)`, "",
    "GST_Registers.xlsx: Summary, Invoice Register, Credit-Debit Notes, AWB Charges, Non-shipment Services.",
    "documents/: PDF of every Vishwaship invoice and note in the period.", "",
    "For you these are purchase (inward supply) documents. Match the Invoice Register with your GSTR-2B.",
    "GSTR-2B status is 'Not verified' because Vishwaship has no access to your GST portal data. ITC eligibility is for your CA to decide.",
    "COD order values are your buyers' money, shown for reference only; they are not Vishwaship charges.",
    ...(truncated ? ["", "The AWB sheet was limited to 5,000 shipments; download a shorter period for the rest."] : []),
  ].join("\r\n") });
  return { name: `${folder}.zip`, data: zip(files) };
}
