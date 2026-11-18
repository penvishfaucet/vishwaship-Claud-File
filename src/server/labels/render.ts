import "server-only";
import { PDFDocument, type PDFFont, type PDFPage, StandardFonts, degrees, rgb } from "pdf-lib";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { getAdapter, providerContext } from "@/server/providers/registry";
import { safeFetch } from "@/server/security/safe-fetch";
import { code128Bars } from "@/lib/code128";
import { type PrintFormat, PRINT_FORMATS } from "@/lib/order-view";
import { labelSource } from "./formats";

const PT = 72 / 25.4;
const ORIGINAL_GENERATED: [number, number] = [101.6, 152.4]; // demo "original" = 4×6 in
/** Narrowest printable bar: 0.19 mm ≈ 1.5 dots at 203 dpi. */
const MIN_MODULE_MM = 0.19;

export type LabelSkip = { orderNumber: string; reason: string };
type Addr = { name?: string; mobile?: string; line1?: string; line2?: string; city?: string; state?: string; pincode?: string; label?: string };

/** WinAnsi-safe text for the standard PDF fonts (names in other scripts are transliterated as "?"). */
const ansi = (s: unknown) => String(s ?? "").replace(/₹/g, "Rs.").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
const rupees = (p: number) => `Rs.${(p / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/**
 * Labels for one or more shipments of this org as a single PDF (one page per label / box).
 * Live carriers: the carrier's own label, requested natively or placed and scaled (never below the
 * readability limit). Demo courier: a Vishwaship-drawn label clearly marked DEMO.
 */
export async function renderLabels(orgId: string, shipmentIds: string[], format: PrintFormat): Promise<{ pdf: Uint8Array | null; pages: number; skipped: LabelSkip[] }> {
  const db = await getDb();
  const rows = shipmentIds.length ? await db.select({ s: schema.shipments, o: schema.orders, w: schema.warehouses }).from(schema.shipments)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.shipments.orderId)).leftJoin(schema.warehouses, eq(schema.warehouses.id, schema.orders.warehouseId))
    .where(and(eq(schema.shipments.orgId, orgId), inArray(schema.shipments.id, shipmentIds))) : [];
  const order = new Map(shipmentIds.map((id, i) => [id, i]));
  rows.sort((a, b) => order.get(a.s.id)! - order.get(b.s.id)!);
  const doc = await PDFDocument.create();
  doc.setTitle(rows.length === 1 ? `Label ${rows[0].s.awb ?? rows[0].o.orderNumber}` : `Labels (${rows.length})`);
  const fonts = { r: await doc.embedFont(StandardFonts.Helvetica), b: await doc.embedFont(StandardFonts.HelveticaBold) };
  const skipped: LabelSkip[] = [];
  for (const id of shipmentIds) if (!rows.some((r) => r.s.id === id)) skipped.push({ orderNumber: id, reason: "Not found" });

  for (const { s, o, w } of rows) {
    if (!s.awb) { skipped.push({ orderNumber: o.orderNumber, reason: "AWB pending — the courier has not assigned it yet" }); continue; }
    if (s.status === "cancelled" || s.bookingStatus === "cancelled") { skipped.push({ orderNumber: o.orderNumber, reason: "Shipment cancelled" }); continue; }
    const src = labelSource(s.provider, format);
    if (src.kind === "unavailable") { skipped.push({ orderNumber: o.orderNumber, reason: src.reason }); continue; }
    const pageMm: [number, number] = format === "original" ? (src.kind === "generated" ? ORIGINAL_GENERATED : [0, 0]) : PRINT_FORMATS.find((p) => p.key === format)!.mm!;

    if (src.kind === "generated") {
      const pkgs = await db.select().from(schema.packages).where(eq(schema.packages.orderId, o.id));
      const boxes = Math.max(1, pkgs.reduce((t, x) => t + x.count, 0));
      const pieceIds = Array.isArray(s.pieceIds) ? (s.pieceIds as string[]) : [];
      const pickup = (o.pickupSnapshot as Addr | null) ?? (w ? { label: w.label, line1: w.line1, line2: w.line2 ?? undefined, city: w.city, state: w.state, pincode: w.pincode, mobile: w.mobile } : null);
      for (let i = 0; i < boxes; i++) {
        // very narrow rolls (38 mm): lay the label out landscape and rotate the page, so the AWB barcode runs along the 100 mm side
        const rotate = pageMm[0] < 45;
        const lay: [number, number] = rotate ? [pageMm[1], pageMm[0]] : pageMm;
        const page = doc.addPage([lay[0] * PT, lay[1] * PT]);
        if (rotate) page.setRotation(degrees(90));
        const err = drawGenerated(page, fonts, {
          demo: s.provider === "demo", carrier: s.carrierName, service: s.serviceName, mode: o.mode, payment: o.paymentType, codPaise: o.codAmountPaise, receiverFreightPaise: s.receiverFreightPaise,
          awb: s.awb, lr: s.lrNumber && s.lrNumber !== s.awb ? s.lrNumber : null, box: i + 1, boxes, pieceId: pieceIds[i] ?? null,
          to: o.consignee as Addr, from: pickup, orderNumber: o.orderNumber, kg: s.chargeableWeightGrams / 1000, invoicePaise: o.declaredValuePaise,
        }, lay);
        if (err) { doc.removePage(doc.getPageCount() - 1); skipped.push({ orderNumber: o.orderNumber, reason: err }); break; }
      }
      continue;
    }

    // live carrier label
    const [acct] = await db.select().from(schema.providerAccounts).where(eq(schema.providerAccounts.id, s.providerAccountId));
    const ad = acct && getAdapter(acct.adapter);
    if (!ad) { skipped.push({ orderNumber: o.orderNumber, reason: "Courier account unavailable" }); continue; }
    const r = await ad.label(await providerContext(acct), { providerOrderRef: s.providerOrderRef ?? s.id, awb: s.awb }, src.carrierFormat);
    if (!r.ok) { skipped.push({ orderNumber: o.orderNumber, reason: r.error.message }); continue; }
    try {
      const added = await placeCarrierLabel(doc, r.value, format === "original" ? null : pageMm);
      if (!added) skipped.push({ orderNumber: o.orderNumber, reason: "The courier returned no label" });
    } catch (e) {
      skipped.push({ orderNumber: o.orderNumber, reason: `Could not read the courier's label: ${(e as Error).message}`.slice(0, 200) });
    }
  }
  const pages = doc.getPageCount();
  return { pdf: pages ? await doc.save() : null, pages, skipped };
}

/** Put the carrier's label (images or PDF) on pages; `pageMm` null = keep the carrier's own size. */
async function placeCarrierLabel(doc: PDFDocument, v: { url?: string; pdf?: Uint8Array; images?: string[] }, pageMm: [number, number] | null): Promise<number> {
  let added = 0;
  const fit = (page: PDFPage, w: number, h: number) => {
    const pw = page.getWidth(), ph = page.getHeight();
    const sc = Math.min(pw / w, ph / h);
    return { x: (pw - w * sc) / 2, y: (ph - h * sc) / 2, width: w * sc, height: h * sc };
  };
  for (const src of v.images ?? []) {
    const bytes = src.startsWith("data:image/") ? Buffer.from(src.slice(src.indexOf(",") + 1), "base64") : await fetchBytes(src);
    const img = bytes[0] === 0x89 ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
    const page = pageMm ? doc.addPage([pageMm[0] * PT, pageMm[1] * PT]) : doc.addPage([img.width * 0.75, img.height * 0.75]);
    page.drawImage(img, fit(page, img.width, img.height));
    added++;
  }
  const pdfBytes = v.pdf ?? (v.url ? await fetchBytes(v.url) : null);
  if (pdfBytes) {
    const srcDoc = await PDFDocument.load(pdfBytes);
    if (!pageMm) {
      const copied = await doc.copyPages(srcDoc, srcDoc.getPageIndices());
      for (const p of copied) { doc.addPage(p); added++; }
    } else {
      const embedded = await doc.embedPages(srcDoc.getPages());
      for (const e of embedded) { const page = doc.addPage([pageMm[0] * PT, pageMm[1] * PT]); page.drawPage(e, fit(page, e.width, e.height)); added++; }
    }
  }
  return added;
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  if (!url.startsWith("https://")) throw new Error("label link is not HTTPS");
  const r = await safeFetch(url, { timeoutMs: 15_000 });
  if (!r.ok) throw new Error(`download failed (${r.status})`);
  const buf = new Uint8Array(await r.arrayBuffer());
  if (buf.length > 10 * 1024 * 1024) throw new Error("label file too large");
  return buf;
}

interface GenLabel {
  demo: boolean; carrier: string; service: string; mode: string; payment: string; codPaise: number; receiverFreightPaise: number;
  awb: string; lr: string | null; box: number; boxes: number; pieceId: string | null;
  to: Addr; from: Addr | null; orderNumber: string; kg: number; invoicePaise: number;
}

/** Draws one generated label. Returns an error when the barcode cannot be printed readably. */
function drawGenerated(page: PDFPage, f: { r: PDFFont; b: PDFFont }, d: GenLabel, mm: [number, number]): string | null {
  const W = page.getWidth(), H = page.getHeight();
  const narrow = Math.min(mm[0], mm[1]) < 60;
  const m = (narrow ? 2 : 3) * PT;
  const inner = W - 2 * m;
  const fs = narrow ? 6.5 : mm[0] < 90 ? 8 : 9;
  let y = H - m;
  const black = rgb(0, 0, 0);
  const text = (s: string, size = fs, font = f.r, opts: { center?: boolean; maxLines?: number } = {}) => {
    const lines = wrap(ansi(s), font, size, inner).slice(0, opts.maxLines ?? 3);
    for (const ln of lines) {
      if (y - size < m) return;
      y -= size * 1.18;
      const x = opts.center ? (W - font.widthOfTextAtSize(ln, size)) / 2 : m;
      page.drawText(ln, { x, y, size, font, color: black });
    }
  };
  const rule = () => { y -= 2; page.drawLine({ start: { x: m, y }, end: { x: W - m, y }, thickness: 0.6, color: black }); y -= 1; };
  const barcode = (value: string, heightMm: number): string | null => {
    const { bars, modules } = code128Bars(value);
    const mod = inner / modules;
    if (mod < MIN_MODULE_MM * PT) return `Barcode for ${value} is too long for this label size`;
    const h = heightMm * PT;
    y -= h + 2;
    for (const [x, wd] of bars) page.drawRectangle({ x: m + x * mod, y, width: wd * mod, height: h, color: black });
    return null;
  };

  if (d.demo) { text("DEMO LABEL - NOT FOR CARRIER HANDOVER", fs - 1, f.b, { center: true, maxLines: 2 }); rule(); }
  const pay = d.payment === "cod" ? `COD ${rupees(d.codPaise)}` : d.payment === "fod" ? `FOD ${rupees(d.receiverFreightPaise)}` : "PREPAID";
  text(d.carrier, fs + 2, f.b, { maxLines: 1 });
  text(`${d.mode}${d.boxes > 1 && d.mode === "B2C" ? " MPS" : ""} | ${pay}`, fs + (narrow ? 0 : 1), f.b, { maxLines: 1 });
  const e1 = barcode(d.awb, narrow ? 9 : 13); if (e1) return e1;
  text(`AWB ${d.awb}`, fs + 1, f.b, { center: true, maxLines: 1 });
  if (d.lr) text(`LR ${d.lr}`, fs, f.b, { center: true, maxLines: 1 });
  if (d.boxes > 1) {
    rule();
    text(`BOX ${d.box} OF ${d.boxes}${d.pieceId ? ` | Piece ${d.pieceId}` : ""}`, fs + 1, f.b, { center: true, maxLines: 2 });
    if (d.pieceId && !narrow) { const e2 = barcode(d.pieceId, 8); if (e2) return e2; }
  }
  rule();
  text("DELIVER TO", fs - 1, f.b, { maxLines: 1 });
  text(d.to.name ?? "", fs + 1, f.b, { maxLines: 1 });
  text([d.to.line1, d.to.line2].filter(Boolean).join(", "), fs, f.r, { maxLines: narrow ? 2 : 3 });
  text(`${d.to.city ?? ""}, ${d.to.state ?? ""}`, fs, f.r, { maxLines: 1 });
  text(`PIN ${d.to.pincode ?? ""}`, fs + 3, f.b, { maxLines: 1 });
  if (!narrow && d.to.mobile) text(`Ph ${d.to.mobile}`, fs, f.r, { maxLines: 1 });
  if (d.from && mm[1] > 110) {
    rule();
    text("RETURN / PICKUP", fs - 1, f.b, { maxLines: 1 });
    text([d.from.label, d.from.line1, d.from.city, d.from.pincode].filter(Boolean).join(", "), fs - 0.5, f.r, { maxLines: 2 });
  }
  rule();
  text(`Order ${d.orderNumber} | ${d.kg.toFixed(2)} kg${narrow ? "" : ` | Value ${rupees(d.invoicePaise)}`}`, fs - 0.5, f.r, { maxLines: 2 });
  return null;
}

function wrap(s: string, font: PDFFont, size: number, max: number): string[] {
  const out: string[] = []; let line = "";
  for (const word of s.split(/\s+/).filter(Boolean)) {
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
