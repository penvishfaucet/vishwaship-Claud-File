import type { PDFFont, PDFImage, PDFPage } from "pdf-lib";
import { rgb } from "pdf-lib";
import { code128Bars } from "@/lib/code128";
import { LABEL_TERMS } from "@/lib/order-view";
import { B2B_HANDOVER, type Box, PT } from "./sheet";

/**
 * Vishwaship label in the courier-label table layout (as on Delhivery B2B labels): bordered rows of
 * logo · date / ID · order / master / PIN · full-width barcode · box · destination | courier logo ·
 * shipping address | product · return address. The Vishwaship logo sits where the courier's logo is on
 * their label, and the courier partner's logo where their label prints the shipper's name.
 * Used for every size with room for it (A4 slots, 4 × 6, 4 × 4, 3 × 4); narrow rolls keep the compact label.
 */
export type TableLabel = {
  carrier: string; mode: string; service: string; payment: string;
  idLabel: "AWB" | "LRN"; parentId: string; carton: number; cartons: number; cartonId: string | null; masterId: string | null;
  date: string; orderNumber: string; invoiceNumber: string | null; invoicePaise: number; products: string; weightKg: number;
  to: { name?: string; mobile?: string; line1?: string; line2?: string; city?: string; state?: string; pincode?: string };
  shipper: { company: string; gstin: string | null; pickup: { line1?: string; line2?: string; city?: string; state?: string; pincode?: string; mobile?: string } | null };
  kind?: "document"; demo: boolean;
  /** Other barcodes from the courier's label (e.g. its order id), each printed in a smaller row under the main one. */
  extraCodes?: string[];
  /** The courier's 2D code as dark-pixel runs [x, y, length] of its image, redrawn exactly (vector, any size). */
  matrix?: { w: number; h: number; runs: Array<[number, number, number]> } | null;
};

const MIN_FONT = 5, MIN_MODULE_MM = 0.19;
/** Reference design size (mm) and the heights of its fixed rows. */
const REF_W = 96;
const ROWS = { a: 11, b: 21, c: 19, d: 7, e: 11, g: 13 };
const F_MIN = 22, FOOT = 9;

const ansi = (s: unknown) => String(s ?? "").replace(/₹/g, "Rs.").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/[^\x20-\x7E\xA0-\xFF]/g, "?").trim();
const rupees = (p: number) => `Rs. ${(p / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function wrap(s: string, font: PDFFont, size: number, max: number): string[] {
  const out: string[] = []; let line = "";
  for (const word of ansi(s).split(/\s+/).filter(Boolean)) {
    const t = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(t, size) <= max) { line = t; continue; }
    if (line) out.push(line);
    line = word;
    while (font.widthOfTextAtSize(line, size) > max && line.length > 1) {
      let i = line.length; while (i > 1 && font.widthOfTextAtSize(line.slice(0, i), size) > max) i--;
      out.push(line.slice(0, i)); line = line.slice(i);
    }
  }
  if (line) out.push(line);
  return out;
}

/** True when a box has room for the table layout; smaller rolls use the compact label. */
export const tableFits = (box: Box) => box.w / PT >= 70 && box.h / PT >= 95;

export function drawTableLabel(page: PDFPage, f: { r: PDFFont; b: PDFFont }, logos: { vs: PDFImage | null; carrier: PDFImage | null }, d: TableLabel, box: Box): string | null {
  let err: string | null = null;
  const black = rgb(0, 0, 0), grey = rgb(0.35, 0.35, 0.35);
  const fixedMm = ROWS.a + ROWS.b + ROWS.c + ROWS.d + ROWS.e + ROWS.g;
  const k = Math.min(box.w / PT / REF_W, box.h / PT / (fixedMm + F_MIN + FOOT), 1.3);
  const W = REF_W * k * PT;
  // centred across the box when the box is wider than the label (4 × 4 in roll, wide A4 slots)
  const x0 = box.x + Math.max(0, (box.w - W) / 2), top = box.y + box.h;
  const fs = Math.max(MIN_FONT, 6.8 * k), small = Math.max(MIN_FONT, 5.8 * k), big = Math.max(MIN_FONT + 1, 9 * k);
  const LH = 1.18, pad = 1.4 * k * PT, line = 0.6;
  const mm = (v: number) => v * k * PT;
  // the flexible shipping-address row takes the remaining height (minus the footnote band)
  // about the courier label's proportions (height ≈ 1.25 × width); any spare height stays below for the notes
  const extras = (d.extraCodes ?? []).slice(0, 2);
  const xH = mm(9) * extras.length;
  const fH = Math.min(Math.max(mm(F_MIN), box.h - mm(fixedMm) - xH - mm(FOOT)), Math.max(mm(F_MIN), mm(REF_W * 1.25 - fixedMm) - xH));
  const tableH = mm(fixedMm) + xH + fH;
  const half = W * 0.5;

  const rect = (x: number, y: number, w: number, h: number) => page.drawRectangle({ x, y, width: w, height: h, borderColor: black, borderWidth: line });
  /** Text block inside a cell, top-aligned; returns false (and flags an error when mandatory) if it does not fit. */
  const cell = (x: number, yTop: number, w: number, h: number, parts: Array<{ t: string; font?: PDFFont; size?: number; center?: boolean }>, mandatory = true) => {
    let y = yTop - pad;
    const lines: Array<{ s: string; font: PDFFont; size: number; center?: boolean }> = [];
    for (const p of parts) for (const s of wrap(p.t, p.font ?? f.r, p.size ?? fs, w - 2 * pad)) lines.push({ s, font: p.font ?? f.r, size: p.size ?? fs, center: p.center });
    const need = lines.reduce((t, l) => t + l.size * LH, 0);
    if (need > h - 2 * pad + 0.5) { if (mandatory) err ??= "Not all mandatory details fit"; return false; }
    if (parts.every((p) => p.center)) y -= (h - 2 * pad - need) / 2; // vertically centred when the whole cell is centred
    for (const l of lines) {
      y -= l.size * LH;
      const tw = l.font.widthOfTextAtSize(l.s, l.size);
      page.drawText(l.s, { x: l.center ? x + (w - tw) / 2 : x + pad, y: y + l.size * 0.22, size: l.size, font: l.font, color: black });
    }
    return true;
  };
  const image = (img: PDFImage, x: number, yTop: number, w: number, h: number) => {
    const bw = w - 2 * pad, bh = h - 2 * pad;
    const s = Math.min(bw / img.width, bh / img.height);
    page.drawImage(img, { x: x + (w - img.width * s) / 2, y: yTop - h + (h - img.height * s) / 2, width: img.width * s, height: img.height * s });
  };

  let y = top;
  // ---- A: Vishwaship logo | Date / ID
  const aH = mm(ROWS.a);
  rect(x0, y - aH, half, aH); rect(x0 + half, y - aH, W - half, aH / 2); rect(x0 + half, y - aH, W - half, aH);
  if (logos.vs) image(logos.vs, x0, y, half, aH); else cell(x0, y, half, aH, [{ t: "vishwaship.com", font: f.b, size: big, center: true }]);
  cell(x0 + half, y, W - half, aH / 2, [{ t: `Date: ${d.date}`, size: small }]);
  cell(x0 + half, y - aH / 2, W - half, aH / 2, [{ t: `${d.idLabel}: ${d.parentId}`, font: f.b, size: small }]);
  y -= aH;

  // ---- B: mode + payment | order / master / PIN
  const bH = mm(ROWS.b), third = bH / 3;
  rect(x0, y - bH, half, bH); for (let i = 0; i < 3; i++) rect(x0 + half, y - third * (i + 1), W - half, third);
  // the courier's 2D code (exactly as on its label) on the left, the label's title beside it
  let mx = x0, mw = half;
  if (d.matrix) {
    const sz = bH - 2 * pad, s = sz / Math.max(d.matrix.w, d.matrix.h);
    const ox = x0 + pad, oy = y - pad - sz;
    for (const [rx, ry, rl] of d.matrix.runs) page.drawRectangle({ x: ox + rx * s, y: oy + sz - (ry + 1) * s, width: rl * s + s * 0.02, height: s * 1.02, color: black });
    mx = x0 + sz + pad; mw = half - sz - pad;
  }
  if (d.kind === "document") cell(mx, y, mw, bH, [
    { t: d.matrix ? "DOCUMENT" : "SHIPMENT DOCUMENT", font: f.b, size: Math.max(MIN_FONT, 10 * k), center: true },
    { t: "Not for a carton", font: f.b, size: small, center: true },
  ], false);
  else {
    cell(mx, y, mw, bH, [
      ...(d.demo ? [{ t: "DEMO - NOT FOR HANDOVER", font: f.b, size: small, center: true }] : []),
      { t: d.mode, font: f.b, size: Math.max(MIN_FONT, (d.matrix ? 12 : 15) * k), center: true },
      { t: d.payment, font: f.b, size: Math.max(MIN_FONT, (d.matrix ? 8 : 10) * k), center: true },
      { t: d.service, size: small, center: true },
    ], false);
  }
  cell(x0 + half, y, W - half, third, [{ t: `OID: ${d.orderNumber}`, size: small }]);
  cell(x0 + half, y - third, W - half, third, [{ t: d.masterId ? `Master: ${d.masterId}` : `Invoice: ${d.invoiceNumber || "-"}`, size: small }]);
  cell(x0 + half, y - 2 * third, W - half, third, [{ t: `${d.to.pincode ?? ""} ${(d.to.city ?? "").toUpperCase()}`, font: f.b, size: fs }]);
  y -= bH;

  // ---- C: full-width barcode (carton waybill, else the AWB / LRN)
  const cH = mm(ROWS.c);
  rect(x0, y - cH, W, cH);
  const code = d.cartonId || d.parentId;
  const { bars, modules } = code128Bars(ansi(code));
  const bw = W * 0.86, mod = bw / modules;
  if (mod < MIN_MODULE_MM * PT) err ??= `The barcode for ${code} is too long to print readably`;
  else {
    const textH = small * LH, barH = cH - 2 * pad - textH;
    const bx = x0 + (W - bw) / 2, by = y - pad - barH;
    for (const [bx0, wd] of bars) page.drawRectangle({ x: bx + bx0 * mod, y: by, width: wd * mod, height: barH, color: black });
    const tw = f.r.widthOfTextAtSize(ansi(code), small);
    page.drawText(ansi(code), { x: x0 + (W - tw) / 2, y: by - textH + small * 0.25, size: small, font: f.r, color: black });
  }
  y -= cH;

  // ---- C2: the courier's other barcodes (as on its label), smaller
  for (const extra of extras) {
    const h = mm(9);
    rect(x0, y - h, W, h);
    const e = code128Bars(ansi(extra));
    const ew = Math.min(W * 0.7, e.modules * 0.3 * PT), emod = ew / e.modules;
    if (emod < MIN_MODULE_MM * PT) { err ??= `The barcode for ${extra} is too long to print readably`; y -= h; continue; }
    const textH = small * LH, barH = h - 2 * pad - textH;
    const ex = x0 + (W - ew) / 2, ey = y - pad - barH;
    for (const [bx0, wd] of e.bars) page.drawRectangle({ x: ex + bx0 * emod, y: ey, width: wd * emod, height: barH, color: black });
    const tw = f.r.widthOfTextAtSize(ansi(extra), small);
    page.drawText(ansi(extra), { x: x0 + (W - tw) / 2, y: ey - textH + small * 0.25, size: small, font: f.r, color: black });
    y -= h;
  }

  // ---- D: Box n/N | MASTER / CHILD
  const dH = mm(ROWS.d);
  rect(x0, y - dH, half, dH); rect(x0 + half, y - dH, W - half, dH);
  const boxText = d.kind === "document" ? "MPS: Documents" : `Box : ${d.carton}/${d.cartons}`;
  const role = d.kind === "document" ? "CHILD" : d.cartons > 1 ? (d.carton === 1 ? "MASTER" : "CHILD") : `${d.weightKg.toFixed(2)} kg`;
  cell(x0, y, half, dH, [{ t: boxText, font: f.b, size: fs, center: true }]);
  cell(x0 + half, y, W - half, dH, [{ t: role, font: f.b, size: fs, center: true }]);
  y -= dH;

  // ---- E: destination | courier partner logo
  const eH = mm(ROWS.e);
  rect(x0, y - eH, half, eH); rect(x0 + half, y - eH, W - half, eH);
  cell(x0, y, half, eH, [{ t: `${d.to.city ?? ""}${d.to.state ? ` (${d.to.state})` : ""}`, size: small }], false);
  if (logos.carrier) image(logos.carrier, x0 + half, y, W - half, eH);
  else cell(x0 + half, y, W - half, eH, [{ t: d.carrier.toUpperCase(), font: f.b, size: fs, center: true }]);
  y -= eH;

  // ---- F: shipping address | product (document: the handover instruction)
  const leftW = W * 0.66;
  rect(x0, y - fH, leftW, fH); rect(x0 + leftW, y - fH, W - leftW, fH);
  const t = d.to;
  cell(x0, y, leftW, fH, [
    { t: "Shipping address :", font: f.b, size: fs },
    { t: t.name ?? "", font: f.b, size: fs },
    { t: [t.line1, t.line2].filter(Boolean).join(", "), size: fs },
    { t: `${[t.city, t.state].filter(Boolean).join(", ")}, IN`, size: fs },
    { t: `PIN ${t.pincode ?? ""}`, font: f.b, size: big },
    ...(t.mobile ? [{ t: `Phone: ${t.mobile}`, size: fs }] : []),
  ]);
  if (d.kind === "document") {
    cell(x0 + leftW, y, W - leftW, fH, [{ t: "DOCUMENT", font: f.b, size: fs, center: true }, { t: B2B_HANDOVER.document, font: f.b, size: small, center: true }], false)
      || cell(x0 + leftW, y, W - leftW, fH, [{ t: "DOCUMENT", font: f.b, size: fs, center: true }, { t: "Staple with the invoice", font: f.b, size: small, center: true }], false);
  } else {
    const paste = d.mode === "B2B" ? [{ t: B2B_HANDOVER.labelShort(d.carton, d.cartons), font: f.b, size: small, center: true }] : [];
    const prod = [...paste, { t: d.products || "-", size: small, center: true }, { t: `Inv ${d.invoiceNumber || "-"}`, size: small, center: true }, { t: rupees(d.invoicePaise), size: small, center: true }];
    if (!cell(x0 + leftW, y, W - leftW, fH, prod, false)) cell(x0 + leftW, y, W - leftW, fH, [...paste, { t: d.products.split(",")[0] || "-", size: small, center: true }], false);
  }
  y -= fH;

  // ---- G: return address (the shipper)
  const gH = mm(ROWS.g);
  rect(x0, y - gH, W, gH);
  const p = d.shipper.pickup;
  const ret = [d.shipper.company, p?.line1, p?.line2, p?.city, p?.state, p?.pincode].filter(Boolean).join(", ");
  if (!cell(x0, y, W, gH, [{ t: "Return address :", font: f.b, size: small }, { t: `${ret}${d.shipper.gstin ? ` | GSTIN ${d.shipper.gstin}` : ""}`, size: small }], false))
    cell(x0, y, W, gH, [{ t: "Return address :", font: f.b, size: small }, { t: ret, size: small }]);
  y -= gH;
  void tableH;

  // ---- footnote under the table: B2B handover + terms, only what fits
  const footH = box.y + box.h - (top - y) > 0 ? y - box.y : 0;
  const notes = [
    ...(d.mode === "B2B" && d.kind !== "document" ? [B2B_HANDOVER.label(d.carton, d.cartons)] : []),
  ];
  const termsFull = [...notes, LABEL_TERMS.full].join(" "), termsShort = [...notes.map(() => B2B_HANDOVER.labelShort(d.carton, d.cartons)), LABEL_TERMS.short].join(" | ");
  for (const variant of [termsFull, termsShort]) {
    const ls = wrap(variant, f.r, MIN_FONT, W);
    if (ls.length * MIN_FONT * LH + 1 > footH) continue;
    let ty = y - 1;
    for (const l of ls) { ty -= MIN_FONT * LH; page.drawText(l, { x: x0, y: ty + MIN_FONT * 0.22, size: MIN_FONT, font: f.r, color: grey }); }
    break;
  }
  return err;
}
