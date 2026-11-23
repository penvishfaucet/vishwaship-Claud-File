import "server-only";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { stateName } from "@/lib/gst";
import type { DocRow } from "./reports";
import type { DocLine } from "./posting";

/**
 * PDF of a posted Vishwaship tax invoice / credit note / debit note, from the stored document and its GST snapshot.
 * Standard PDF fonts cannot draw "₹", so amounts are printed as "Rs.". Text is kept to the Latin-1 range.
 */
const TITLE: Record<string, string> = { invoice: "TAX INVOICE", credit_note: "CREDIT NOTE", debit_note: "DEBIT NOTE" };
const latin = (s: unknown) => String(s ?? "").replace(/₹/g, "Rs.").replace(/[—–]/g, "-").replace(/[^\x20-\x7E\xA0-\xFF]/g, "");
const money = (p: number) => (p / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (d: Date) => d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });

export async function documentPdf(doc: DocRow, company: { legalName: string; gstin: string; address: string; email: string }): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${TITLE[doc.kind] ?? "Document"} ${doc.number}`); pdf.setAuthor(company.legalName || "Vishwaship"); pdf.setCreationDate(doc.docDate);
  const font = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28, H = 841.89, M = 36;
  let page: PDFPage = pdf.addPage([W, H]), y = H - M;
  const ink = rgb(0.02, 0.11, 0.27), mut = rgb(0.33, 0.38, 0.48), orange = rgb(0.76, 0.25, 0.05);
  const text = (s: unknown, x: number, size = 9, f: PDFFont = font, color = ink) => page.drawText(latin(s), { x, y, size, font: f, color });
  const right = (s: unknown, xr: number, size = 9, f: PDFFont = font) => { const t = latin(s); page.drawText(t, { x: xr - f.widthOfTextAtSize(t, size), y, size, font: f, color: ink }); };
  const wrap = (s: unknown, width: number, size = 9, f: PDFFont = font) => {
    const words = latin(s).split(/\s+/); const out: string[] = []; let cur = "";
    for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (f.widthOfTextAtSize(t, size) > width && cur) { out.push(cur); cur = w; } else cur = t; }
    if (cur) out.push(cur); return out.length ? out : [""];
  };
  const rule = (c = rgb(0.86, 0.89, 0.93)) => page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.7, color: c });

  // header: supplier on the left, document details on the right; the rule goes below whichever is longer
  text(company.legalName || "Vishwaship", M, 16, bold); right(TITLE[doc.kind] ?? doc.kind, W - M, 14, bold); y -= 16;
  for (const l of wrap(company.address, 300, 8).slice(0, 4)) { text(l, M, 8, font, mut); y -= 10; }
  text(`GSTIN: ${doc.tax.supplierGstin ?? "not set"}   ${company.email}`, M, 8, font, mut); y -= 10;
  const leftY = y;
  y = H - M - 18; right(`No. ${doc.number}`, W - M, 9, bold); y -= 12; right(`Date ${day(doc.docDate)}`, W - M); y -= 12;
  right(`GST period ${doc.tax.taxPeriod}`, W - M, 8); y -= 12;
  if (doc.kind !== "invoice" && doc.originalNumber) { right(`Against invoice ${doc.originalNumber}`, W - M, 8); y -= 12; }
  y = Math.min(y, leftY) - 4; rule(orange); y -= 16;

  // parties
  text("Bill to", M, 8, bold, mut); text("Supply details", 320, 8, bold, mut); y -= 12;
  text(doc.tax.recipientName ?? "", M, 10, bold); text(`Place of supply: ${doc.tax.placeOfSupply ?? "-"} ${stateName(doc.tax.placeOfSupply)}`, 320); y -= 12;
  text(`GSTIN: ${doc.tax.recipientGstin ?? "Unregistered"}`, M); text(`SAC: ${doc.tax.sac}   Reverse charge: No`, 320); y -= 12;
  if (doc.periodFrom && doc.periodTo) { text(`Service period: ${day(doc.periodFrom)} to ${day(doc.periodTo)}`, 320); y -= 12; }
  if (doc.reason) { for (const l of wrap(`Reason: ${doc.reason}`, 500)) { text(l, M); y -= 12; } }
  if (doc.tax.derived) { text("GST split derived from current company and customer details (document issued before GST snapshots).", M, 7, font, mut); y -= 10; }
  y -= 6;

  // lines
  // #, AWB (room for 18+ characters), description, then right-aligned amounts
  const cols = [M, M + 20, M + 124, M + 300, M + 350, M + 385, M + 440, W - M];
  const header = () => {
    page.drawRectangle({ x: M, y: y - 4, width: W - 2 * M, height: 16, color: rgb(0.93, 0.95, 0.98) });
    text("#", cols[0] + 2, 8, bold); text("AWB / Ref", cols[1], 8, bold); text("Description", cols[2], 8, bold);
    right("Taxable", cols[4] - 4, 8, bold); right("Rate", cols[5] - 4, 8, bold); right("GST", cols[6] - 4, 8, bold); right("Amount", cols[7], 8, bold); y -= 18;
  };
  header();
  const lines = ((doc.lines as DocLine[]) ?? []);
  lines.forEach((l, i) => {
    const desc = wrap(l.description, cols[4] - 62 - cols[2], 8);
    if (y - desc.length * 10 < M + 120) { page = pdf.addPage([W, H]); y = H - M; header(); }
    text(i + 1, cols[0] + 2, 8);
    { const ref = latin(l.awb ?? l.ref ?? ""), maxW = cols[2] - cols[1] - 6; let sz = 8; while (sz > 5.5 && font.widthOfTextAtSize(ref, sz) > maxW) sz -= 0.5; text(ref, cols[1], sz); }
    right(money(l.taxablePaise), cols[4] - 4, 8); right(l.rateBps != null ? `${l.rateBps / 100}%` : "", cols[5] - 4, 8);
    right(money(l.gstPaise), cols[6] - 4, 8); right(money(l.taxablePaise + l.gstPaise), cols[7], 8);
    desc.forEach((d, k) => { text(d, cols[2], 8); if (k < desc.length - 1) y -= 10; });
    y -= 13;
  });
  rule(); y -= 16;

  // totals
  const tot = (label: string, p: number, b = false) => { if (!p && !b) return; text(label, 360, 9, b ? bold : font); right(money(p), W - M, 9, b ? bold : font); y -= 13; };
  tot("Taxable value", doc.taxablePaise, true);
  tot("CGST", doc.tax.cgstPaise); tot("SGST", doc.tax.sgstPaise); tot("UTGST", doc.tax.utgstPaise); tot("IGST", doc.tax.igstPaise);
  tot(doc.kind === "invoice" ? "Invoice total (Rs.)" : "Note total (Rs.)", doc.totalPaise, true);
  y -= 10;
  text("Computer-generated document from Vishwaship billing records.", M, 7, font, mut);
  return pdf.save();
}
