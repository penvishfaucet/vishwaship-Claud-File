import type { PDFFont, PDFPage } from "pdf-lib";
import { rgb } from "pdf-lib";

/** A4 sheet layouts for labels (one shipment per sheet) and the shipper's invoice block (A4 · label + invoice). */
export const PT = 72 / 25.4;
/** A4 printer-safe margin (mm) and the gap between labels. */
export const A4_MARGIN = 6, A4_GAP = 4;
export type Box = { x: number; y: number; w: number; h: number };
type Addr = { name?: string; line1?: string; line2?: string; city?: string; state?: string; pincode?: string };

/** WinAnsi-safe text for the standard PDF fonts (other scripts become "?"). */
const ansi = (s: unknown) => String(s ?? "").replace(/₹/g, "Rs.").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/[^\x20-\x7E\xA0-\xFF]/g, "?").trim();
const rupees = (p: number) => `Rs. ${(p / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The shipper's invoice printed under the label. Amounts in paise. Never carries the COD amount. */
export interface InvoiceBlock {
  seller: { name: string; address: string; gstin: string | null; phone?: string };
  number: string; date: string; orderNumber: string; buyer: Addr; buyerGstin: string | null;
  items: Array<{ name: string; hsn?: string; qty: number; unitPrice: number }>; payment: string; shippedVia: string; ewayBill: string | null;
  footer?: string; signature?: string; showHsn: boolean;
}

/** Label boxes in a grid inside a horizontal band of an A4 sheet (topMm from the top edge, bandMm tall). */
export function gridBoxes(cols: number, rws: number, topMm: number, bandMm: number): Box[] {
  const w = (210 - 2 * A4_MARGIN - (cols - 1) * A4_GAP) / cols, h = (bandMm - 2 * A4_MARGIN - (rws - 1) * A4_GAP) / rws;
  const out: Box[] = [];
  for (let r = 0; r < rws; r++) for (let c = 0; c < cols; c++) {
    const yTop = 297 - topMm - A4_MARGIN - r * (h + A4_GAP);
    out.push({ x: (A4_MARGIN + c * (w + A4_GAP)) * PT, y: (yTop - h) * PT, w: w * PT, h: h * PT });
  }
  return out;
}

/** Grid for N labels of one shipment on one A4 sheet: 1, 2 or 3 stacked; 4 as 2 × 2; 5–6 as 2 × 3. */
export function fitGrid(n: number): [number, number] {
  return n <= 1 ? [1, 1] : n === 2 ? [1, 2] : n === 3 ? [1, 3] : n === 4 ? [2, 2] : [2, 3];
}

/** Dashed cut line across the middle of an A4 sheet. */
export function cutLine(page: PDFPage, f: PDFFont) {
  const y = 148.5 * PT;
  page.drawLine({ start: { x: A4_MARGIN * PT, y }, end: { x: (210 - A4_MARGIN) * PT, y }, thickness: 0.6, color: rgb(0.55, 0.55, 0.55), dashArray: [4, 3] });
  page.drawText("cut here", { x: (210 - A4_MARGIN) * PT - f.widthOfTextAtSize("cut here", 6), y: y + 2, size: 6, font: f, color: rgb(0.5, 0.5, 0.5) });
}

/** Bottom half of an A4 sheet, inside the margins. */
export const LOWER_HALF: Box = { x: A4_MARGIN * PT, y: A4_MARGIN * PT, w: (210 - 2 * A4_MARGIN) * PT, h: (148.5 - 2 * A4_MARGIN) * PT };

/** The shipper's invoice in a box. Text is fitted to its column; long item lists end with "+N more". */
export function drawInvoice(page: PDFPage, f: { r: PDFFont; b: PDFFont }, d: InvoiceBlock, box: Box) {
  const ink = rgb(0.07, 0.09, 0.15), mut = rgb(0.35, 0.38, 0.45), line = rgb(0.75, 0.77, 0.8);
  const pad = 4 * PT;
  const x0 = box.x + pad, x1 = box.x + box.w - pad;
  let y = box.y + box.h - pad;
  const fit = (t: string, font: PDFFont, size: number, w: number) => {
    let s = ansi(t);
    if (font.widthOfTextAtSize(s, size) <= w) return s;
    while (s.length > 1 && font.widthOfTextAtSize(`${s}...`, size) > w) s = s.slice(0, -1);
    return `${s}...`;
  };
  const text = (t: string, x: number, size: number, font = f.r, color = ink, w = x1 - x) => page.drawText(fit(t, font, size, w), { x, y, size, font, color });
  const right = (t: string, xr: number, size: number, font = f.r, color = ink) => { const s = ansi(t); page.drawText(s, { x: xr - font.widthOfTextAtSize(s, size), y, size, font, color }); };
  page.drawRectangle({ x: box.x, y: box.y, width: box.w, height: box.h, borderColor: line, borderWidth: 0.6 });

  // header: seller on the left, INVOICE + numbers on the right
  const leftW = box.w * 0.6;
  y -= 12; text(d.seller.name, x0, 11, f.b, ink, leftW); right("INVOICE", x1, 13, f.b);
  y -= 11; text(d.seller.address, x0, 7.5, f.r, mut, leftW); right(`No. ${d.number}`, x1, 8, f.b);
  y -= 10; text([d.seller.gstin ? `GSTIN ${d.seller.gstin}` : "", d.seller.phone ?? ""].filter(Boolean).join("  |  "), x0, 7.5, f.r, mut, leftW); right(`Date ${d.date}`, x1, 8);
  y -= 10; right(`Order ${d.orderNumber}`, x1, 8);
  y -= 6; page.drawLine({ start: { x: x0, y }, end: { x: x1, y }, thickness: 0.8, color: ink });

  // buyer + payment / shipping
  const half = (x1 - x0) / 2;
  y -= 12; text("Bill / ship to", x0, 7.5, f.b, mut, half); text("Payment & shipping", x0 + half + 6, 7.5, f.b, mut, half - 6);
  const b = d.buyer;
  const a = [b.name ?? "", [b.line1, b.line2].filter(Boolean).join(", "), [b.city, b.state, b.pincode].filter(Boolean).join(", "), d.buyerGstin ? `GSTIN ${d.buyerGstin}` : ""].filter(Boolean);
  const p = [d.payment, d.shippedVia, d.ewayBill ? `E-way bill ${d.ewayBill}` : ""].filter(Boolean);
  for (let i = 0; i < Math.max(a.length, p.length); i++) {
    y -= 10;
    if (a[i]) text(a[i], x0, i === 0 ? 8.5 : 8, i === 0 ? f.b : f.r, ink, half - 4);
    if (p[i]) text(p[i], x0 + half + 6, 8, i === 0 ? f.b : f.r, ink, half - 6);
  }

  // items
  y -= 14;
  const cAmt = x1 - 3, cRate = x1 - 70, cQty = x1 - 135;
  const cHsn = d.showHsn ? cQty - 75 : cQty - 10;
  page.drawRectangle({ x: x0, y: y - 3, width: x1 - x0, height: 13, color: rgb(0.94, 0.95, 0.97) });
  text("Item", x0 + 3, 7.5, f.b, ink, cHsn - x0 - 8);
  if (d.showHsn) text("HSN", cHsn, 7.5, f.b, ink, 60);
  right("Qty", cQty, 7.5, f.b); right("Rate", cRate, 7.5, f.b); right("Amount", cAmt, 7.5, f.b);
  const footerSpace = 46;
  const room = Math.max(1, Math.floor((y - (box.y + pad + footerSpace)) / 11) - 1);
  const shown = d.items.length > room ? d.items.slice(0, Math.max(0, room - 1)) : d.items;
  for (const it of shown) {
    y -= 11;
    text(it.name, x0 + 3, 8, f.r, ink, cHsn - x0 - 8);
    if (d.showHsn) text(it.hsn ?? "", cHsn, 8, f.r, ink, 60);
    right(String(it.qty), cQty, 8); right(rupees(it.unitPrice), cRate, 8); right(rupees(it.qty * it.unitPrice), cAmt, 8);
  }
  if (shown.length < d.items.length) { y -= 11; text(`+${d.items.length - shown.length} more item(s) - see the full invoice`, x0 + 3, 7.5, f.r, mut); }
  if (!d.items.length) { y -= 11; text("No item details on this order", x0 + 3, 8, f.r, mut); }
  y -= 6; page.drawLine({ start: { x: x0, y }, end: { x: x1, y }, thickness: 0.5, color: line });
  y -= 12; right(`Total  ${rupees(d.items.reduce((t, i) => t + i.qty * i.unitPrice, 0))}`, cAmt, 9.5, f.b);

  // footer
  y = box.y + pad + 14;
  text(d.footer || "This is a computer-generated invoice.", x0, 7, f.r, mut, half);
  right(d.signature || "Authorised signatory", x1, 7.5, f.b);
  y -= 9; right(`for ${d.seller.name}`, x1, 7, f.r, mut);
}

/** How B2B paperwork is used: one document stapled with the invoice for the pickup person, one label on each carton. */
export const B2B_HANDOVER = {
  document: "Staple this document with the invoice and hand both to the pickup person. Do not paste it on a carton.",
  label: (carton: number, cartons: number) => `Paste this label on carton ${carton} of ${cartons}. The shipment document goes with the invoice to the pickup person.`,
  labelShort: (carton: number, cartons: number) => `Paste on carton ${carton} of ${cartons}`,
  notice: "B2B shipment: staple the shipment document with the invoice and hand both to the pickup person; paste one label on each carton.",
};
