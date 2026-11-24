import "server-only";
import { PDFDocument, type PDFFont, type PDFImage, type PDFPage, StandardFonts, degrees, rgb } from "pdf-lib";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { adapterFor, providerContext } from "@/server/providers/registry";
import { safeFetch } from "@/server/security/safe-fetch";
import { code128Bars } from "@/lib/code128";
import { LABEL_TERMS, type PrintFormat, PRINT_FORMATS } from "@/lib/order-view";
import type { LabelFormat } from "@/server/providers/types";
import { CARRIER_POLICY, labelSource } from "./formats";
import { coverBranding } from "./cover";
import { BRAND_REPLACEMENT, replaceBrandText } from "./brand-text";
import { decodePng, findBrandInImage } from "./image-brand";
import { type PageScan, mergeScans, scanLabelImage } from "./barcode-read";
import { PDFName, PDFRawStream, PDFRef, type PDFDict, decodePDFRawStream } from "pdf-lib";
import { CARRIER_LOGOS, type LabelLogo, VISHWASHIP_LOGO } from "./logos.generated";
import { noteCapability } from "@/server/carriers/verification";
import { labelStrings } from "./strings";
import { orgSetting } from "@/server/couriers";
import { paymentLabel } from "@/lib/payment";
import { B2B_HANDOVER, type InvoiceBlock, cutLine, drawInvoice, gridBoxes, LOWER_HALF } from "./sheet";
import { drawTableLabel, tableFits } from "./table-label";
export { B2B_HANDOVER };

const PT = 72 / 25.4;
/** Narrowest printable bar: 0.19 mm ≈ 1.5 dots at 203 dpi. */
const MIN_MODULE_MM = 0.19;
/** Smallest text we print (pt). */
const MIN_FONT = 5;
/** A4 printer-safe margin (mm) and the gap between labels. */
const A4_MARGIN = 6, A4_GAP = 4;

export type LabelSkip = { shipmentId: string; orderNumber: string; reason: string; retryable: boolean };
type Addr = { name?: string; mobile?: string; line1?: string; line2?: string; city?: string; state?: string; pincode?: string; label?: string; contactName?: string };
type Product = { name?: string; qty?: number };

/** WinAnsi-safe text for the standard PDF fonts (names in other scripts are transliterated as "?"). */
const ansi = (s: unknown) => String(s ?? "").replace(/₹/g, "Rs.").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/[^\x20-\x7E\xA0-\xFF]/g, "?").trim();
const rupees = (p: number) => `Rs. ${(p / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** One Vishwaship label (one carton). No COD amount is ever part of this data. */
export interface BrandedLabel {
  demo: boolean; carrier: string; carrierLogo: LabelLogo | null; mode: string; service: string; payment: "PREPAID" | "COD" | "FOD" | string;
  idLabel: "AWB" | "LRN"; parentId: string; carton: number; cartons: number; cartonId: string | null;
  to: Addr; shipper: { company: string; gstin: string | null; pickup: Addr | null };
  orderNumber: string; invoiceNumber: string | null; invoicePaise: number; products: string; weightKg: number;
  /** B2B only: the one shipment document (stapled with the invoice, handed to the pickup person) instead of a carton label. */
  kind?: "document"; cartonIds?: string[]; ewayBill?: string | null;
  /** Booking date (as printed) and, for multi-carton B2B, the master carton waybill (carton 1). */
  date?: string; masterId?: string | null;
  /** Other barcodes on the courier's label (e.g. its order id), printed as they are. */
  extraCodes?: string[];
  /** The courier's 2D code, redrawn exactly (dark-pixel runs of its image). */
  matrix?: PageScan["matrix"];
}



/** Product names (with quantity); long lists end with "+N more" so the label never overflows on them. */
function productLine(products: Product[]) {
  const names = products.map((p) => `${ansi(p.name)}${p.qty && p.qty > 1 ? ` x${p.qty}` : ""}`);
  const shown = names.slice(0, 3).map((n) => (n.length > 60 ? `${n.slice(0, 57)}...` : n));
  return shown.join(", ") + (names.length > 3 ? ` +${names.length - 3} more` : "");
}

/** Resolve the booked carrier's logo by name ("Delhivery Surface" → delhivery). Null → print the carrier name. */
export function carrierLogoFor(name: string): LabelLogo | null {
  const n = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  const keys = Object.keys(CARRIER_LOGOS).sort((a, b) => b.length - a.length);
  const k = keys.find((x) => n.startsWith(x.replace(/[^a-z0-9]/g, ""))) ?? keys.find((x) => n.includes(x.replace(/[^a-z0-9]/g, "")));
  return k ? CARRIER_LOGOS[k] : null;
}

/**
 * Labels for shipments as one PDF. `orgId` null = Admin (any account); otherwise only that account's shipments.
 * Every size draws the Vishwaship label from the saved booking; "original" places the courier's own label.
 * Nothing here books, re-books or charges: it only reads the existing booking.
 */
export async function renderLabels(orgId: string | null, shipmentIds: string[], format: PrintFormat): Promise<{ pdf: Uint8Array | null; pages: number; labels: number; skipped: LabelSkip[]; notices: string[] }> {
  const db = await getDb();
  const rows = shipmentIds.length ? await db.select({ s: schema.shipments, o: schema.orders, w: schema.warehouses, org: schema.orgs }).from(schema.shipments)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.shipments.orderId)).innerJoin(schema.orgs, eq(schema.orgs.id, schema.shipments.orgId))
    .leftJoin(schema.warehouses, eq(schema.warehouses.id, schema.orders.warehouseId))
    .where(orgId ? and(eq(schema.shipments.orgId, orgId), inArray(schema.shipments.id, shipmentIds)) : inArray(schema.shipments.id, shipmentIds)) : [];
  const order = new Map(shipmentIds.map((id, i) => [id, i]));
  rows.sort((a, b) => order.get(a.s.id)! - order.get(b.s.id)!);
  // the demo courier has no label of its own: its "original" is the Vishwaship label at 4 × 6 in
  const layoutFormat: PrintFormat = format === "original" ? "thermal_4x6" : format;
  const fmt = PRINT_FORMATS.find((p) => p.key === layoutFormat)!;
  const doc = await PDFDocument.create();
  doc.setTitle(rows.length === 1 ? `Label ${rows[0].s.awb ?? rows[0].o.orderNumber}` : `Labels (${rows.length})`);
  doc.setCreator("Vishwaship");
  const fonts = { r: await doc.embedFont(StandardFonts.Helvetica), b: await doc.embedFont(StandardFonts.HelveticaBold) };
  const thermal = fmt.group === "thermal";
  const imgCache = new Map<string, PDFImage>();
  const img = async (l: LabelLogo) => {
    const k = (thermal ? l.mono : l.color).slice(0, 64) + l.w;
    if (!imgCache.has(k)) imgCache.set(k, await doc.embedPng(Buffer.from(thermal ? l.mono : l.color, "base64")));
    return imgCache.get(k)!;
  };
  const skipped: LabelSkip[] = [];
  const notices = new Set<string>();
  for (const id of shipmentIds) if (!rows.some((r) => r.s.id === id)) skipped.push({ shipmentId: id, orderNumber: id, reason: "Not found", retryable: false });
  const branded: BrandedLabel[] = [];
  // the shipper's own business name + GSTIN: Invoice settings first, then the account profile
  const invoice = new Map<string, { businessName?: string; gstin?: string }>();
  for (const oid of new Set(rows.map((r) => r.org.id))) invoice.set(oid, (await orgSetting<{ businessName?: string; gstin?: string }>(oid, "invoice_settings")) ?? {});
  const inv = (oid: string) => invoice.get(oid) ?? {};
  const brandedOf = new Map<BrandedLabel, string>(); // label → shipment id (for errors)
  const invoices = new Map<string, InvoiceBlock>(); // shipment id → invoice (A4 · label + invoice)

  for (const { s, o, w, org } of rows) {
    const skip = (reason: string, retryable = false) => skipped.push({ shipmentId: s.id, orderNumber: o.orderNumber, reason, retryable });
    if (s.status === "cancelled" || s.bookingStatus === "cancelled") { skip("Shipment cancelled"); continue; }
    if (!s.awb) { skip("Label pending — the courier has not assigned the AWB / LRN yet", true); continue; }
    if (process.env.NODE_ENV === "production" && (s.provider === "demo" || /^DEMO/i.test(s.awb))) { skip("Demo shipment — no label is printed in production"); continue; }
    const src = labelSource(s.provider, format);
    if (src.kind === "unavailable") { skip(src.reason); continue; }

    if (src.kind === "branded") {
      const pkgs = await db.select().from(schema.packages).where(eq(schema.packages.orderId, o.id));
      const pieceIds = (Array.isArray(s.pieceIds) ? (s.pieceIds as unknown[]) : []).map(String).filter(Boolean);
      const cartons = Math.max(1, pkgs.reduce((t, x) => t + x.count, 0), pieceIds.length);
      // Owner rule: only Delhivery B2B (an LR booking) has a shipment document and LRN labels. Every other courier
      // (Shipmozo B2B / B2C — even its Delhivery services —, Delhivery B2C, TCI, …) gets carton labels only.
      // The demo courier stands in for Delhivery B2B on B2B orders.
      const isB2B = s.provider === "delhivery_b2b" || (s.provider === "demo" && o.mode === "B2B");
      // B2B cartons are scanned by their own waybill; without it a branded carton label would not match the carrier's records
      if (isB2B && cartons > 1 && s.provider !== "demo" && pieceIds.length < cartons) {
        skip(`The courier has not sent the carton barcodes for all ${cartons} cartons yet — download the Carrier label, or retry later`, true);
        continue;
      }
      const pol = CARRIER_POLICY[s.provider];
      if (pol?.note) notices.add(`${s.carrierName}: ${pol.note}`);
      const meta = (o.meta ?? {}) as { grandTotalPaise?: number };
      const products = ((o.products ?? []) as Product[]).filter((p) => p?.name);
      const pickup = (o.pickupSnapshot as Addr | null) ?? (w ? { label: w.label, contactName: w.contactName, line1: w.line1, line2: w.line2 ?? undefined, city: w.city, state: w.state, pincode: w.pincode, mobile: w.mobile } : null);
      const logo = carrierLogoFor(s.carrierName);
      if (layoutFormat === "a4_doc") {
        const look = ((await orgSetting<Record<string, unknown>>(org.id, "invoice_settings")) ?? {}) as { businessName?: string; gstin?: string; address?: string; phone?: string; prefix?: string; footer?: string; signatureText?: string; showHsn?: boolean };
        const items = ((o.products ?? []) as Array<{ name?: string; qty?: number; unitPrice?: number; hsn?: string }>).filter((x) => x?.name).map((x) => ({ name: String(x.name), hsn: x.hsn, qty: Number(x.qty) || 1, unitPrice: Number(x.unitPrice) || 0 }));
        invoices.set(s.id, {
          seller: { name: look.businessName || inv(org.id).businessName || org.businessName, gstin: look.gstin || inv(org.id).gstin || org.gstin || null, phone: look.phone,
            address: look.address || (pickup ? [pickup.line1, pickup.line2, pickup.city, pickup.state, pickup.pincode].filter(Boolean).join(", ") : "") },
          number: `${look.prefix ?? ""}${o.invoiceNumber ?? o.orderNumber}`, date: o.createdAt.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }),
          orderNumber: o.orderNumber, buyer: o.consignee as Addr, buyerGstin: o.buyerGstin ?? null, items,
          // like the label, the printed sheet never shows the COD amount
          payment: paymentLabel(o.paymentType, o.codAmountPaise), shippedVia: `${s.carrierName} · ${isB2B ? "LRN" : "AWB"} ${s.lrNumber && isB2B ? s.lrNumber : s.awb}`, ewayBill: o.ewayBill ?? null,
          footer: look.footer, signature: look.signatureText, showHsn: look.showHsn !== false,
        });
      }
      const bookedOn = s.createdAt.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });
      let docLabel: BrandedLabel | null = null;
      if (isB2B) {
        notices.add(B2B_HANDOVER.notice);
        const doc: BrandedLabel = {
          demo: s.provider === "demo", carrier: s.carrierName, carrierLogo: logo, mode: o.mode, service: s.serviceName,
          payment: paymentLabel(o.paymentType, o.codAmountPaise).toUpperCase(),
          idLabel: "LRN", parentId: s.lrNumber ?? s.awb, carton: 0, cartons, cartonId: null,
          to: o.consignee as Addr,
          shipper: { company: inv(org.id).businessName || org.businessName, gstin: inv(org.id).gstin || org.gstin || null, pickup },
          orderNumber: o.orderNumber, invoiceNumber: o.invoiceNumber ?? null, invoicePaise: meta.grandTotalPaise ?? o.declaredValuePaise,
          products: productLine(products), weightKg: s.chargeableWeightGrams / 1000,
          kind: "document", cartonIds: pieceIds.filter((x) => x !== (s.lrNumber ?? s.awb)), ewayBill: o.ewayBill ?? null,
          date: bookedOn, masterId: isB2B && cartons > 1 && pieceIds[0] ? pieceIds[0] : null,
        };
        docLabel = doc;
      }
      for (let i = 0; i < cartons; i++) {
        const l: BrandedLabel = {
          demo: s.provider === "demo", carrier: s.carrierName, carrierLogo: logo, mode: o.mode, service: s.serviceName,
          payment: paymentLabel(o.paymentType, o.codAmountPaise).toUpperCase(),
          idLabel: isB2B ? "LRN" : "AWB", parentId: s.lrNumber && isB2B ? s.lrNumber : s.awb, carton: i + 1, cartons,
          cartonId: pieceIds[i] && pieceIds[i] !== (s.lrNumber ?? s.awb) ? pieceIds[i] : null,
          to: o.consignee as Addr,
          // the shipping customer's own company and GSTIN — never Vishwaship's
          shipper: { company: inv(org.id).businessName || org.businessName, gstin: inv(org.id).gstin || org.gstin || null, pickup },
          orderNumber: o.orderNumber, invoiceNumber: o.invoiceNumber ?? null, invoicePaise: meta.grandTotalPaise ?? o.declaredValuePaise,
          products: productLine(products), weightKg: s.chargeableWeightGrams / 1000,
          date: bookedOn, masterId: isB2B && cartons > 1 && pieceIds[0] ? pieceIds[0] : null,
        };
        branded.push(l); brandedOf.set(l, s.id);
      }
      // as on the courier's sheet: the carton labels first, then the shipment document
      if (docLabel) { branded.push(docLabel); brandedOf.set(docLabel, s.id); }
      continue;
    }

    if (src.kind === "matched") {
      // ---- Vishwaship label with the courier's own barcodes: read every label the courier made, one of ours per label
      const scans: PageScan[] = [];
      const got = await courierLabel(s, src.carrierFormat, scans);
      if (!got.doc) { skip(got.error, got.retryable); continue; }
      // one or more labels per courier page (Shipmozo puts a Delhivery B2B LR's labels on one sheet); every one must read
      if (!scans.length || scans.length < got.doc.getPageCount() || scans.some((x) => !x.codes.length)) {
        // a barcode we cannot read is never guessed: this shipment gets the courier's own label (barcodes unchanged)
        notices.add(`${o.orderNumber}: the courier's own label is included for this shipment (its barcodes could not be read for the Vishwaship label).`);
        await coverBranding(got.doc, s.provider);
        try { await replaceBrandText(got.doc, s.provider); } catch (e) { console.error("label brand text", s.id, (e as Error).message); }
        for (const pg of await doc.copyPages(got.doc, got.doc.getPageIndices())) doc.addPage(pg);
        continue;
      }
      // LR bookings: Delhivery B2B direct, and Delhivery B2B booked through Shipmozo (its LRN differs from the master waybill)
      const isLR = s.provider === "delhivery_b2b" || (s.provider === "shipmozo" && !!s.lrNumber && s.lrNumber !== s.awb);
      const pkgs = await db.select().from(schema.packages).where(eq(schema.packages.orderId, o.id));
      const boxes = Math.max(1, pkgs.reduce((t, x) => t + x.count, 0));
      // Delhivery B2B: one label per carton, then "MPS: Documents" (the shipment document with its own waybill)
      const docIndex = isLR && scans.length >= 2 && scans.length === boxes + 1 ? scans.length - 1 : -1;
      const cartons = docIndex >= 0 ? scans.length - 1 : scans.length;
      const main = (x: PageScan) => [...x.codes].sort((a, b) => (b.x1 - b.x0) - (a.x1 - a.x0))[0].text;
      const meta = (o.meta ?? {}) as { grandTotalPaise?: number };
      const products = ((o.products ?? []) as Product[]).filter((x) => x?.name);
      const pickup = (o.pickupSnapshot as Addr | null) ?? (w ? { label: w.label, contactName: w.contactName, line1: w.line1, line2: w.line2 ?? undefined, city: w.city, state: w.state, pincode: w.pincode, mobile: w.mobile } : null);
      const logo = carrierLogoFor(s.carrierName);
      const bookedOn = s.createdAt.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });
      if (isLR) notices.add(B2B_HANDOVER.notice);
      scans.forEach((scan, i) => {
        const code = main(scan);
        const l: BrandedLabel = {
          demo: false, carrier: s.carrierName, carrierLogo: logo, mode: isLR ? "B2B" : "B2C", service: s.serviceName,
          payment: paymentLabel(o.paymentType, o.codAmountPaise).toUpperCase(),
          idLabel: isLR ? "LRN" : "AWB", parentId: isLR ? (s.lrNumber ?? s.awb!) : s.awb!, carton: i === docIndex ? 0 : i + 1, cartons,
          cartonId: code, extraCodes: scan.codes.map((c) => c.text).filter((t) => t !== code),
          to: o.consignee as Addr,
          shipper: { company: inv(org.id).businessName || org.businessName, gstin: inv(org.id).gstin || org.gstin || null, pickup },
          orderNumber: o.orderNumber, invoiceNumber: o.invoiceNumber ?? null, invoicePaise: meta.grandTotalPaise ?? o.declaredValuePaise,
          products: productLine(products), weightKg: s.chargeableWeightGrams / 1000,
          date: bookedOn, masterId: isLR && scans.length > 1 ? main(scans[0]) : null, // as the courier prints it (also on its document label)
          ...(i === docIndex ? { kind: "document" as const, ewayBill: o.ewayBill ?? null } : {}),
        };
        branded.push(l); brandedOf.set(l, s.id);
      });
      continue;
    }

    // ---- Courier label: exactly the courier's own file — same pages, same barcodes. Only the account name / logo
    // the courier prints for our aggregator account is replaced by Vishwaship's.
    if (o.paymentType === "cod") notices.add("Courier labels show the COD amount because the courier prints it on its own label.");
    if (format !== "original" && src.carrierFormat !== format && !(src.carrierFormat === "a4" && PRINT_FORMATS.find((p) => p.key === format)?.group === "a4")) {
      const size = PRINT_FORMATS.find((p) => p.key === src.carrierFormat)?.name ?? "A4";
      notices.add(`${s.carrierName}: the courier's label comes in ${size}, so it is downloaded in that size.`);
    }
    const got = await courierLabel(s, src.carrierFormat);
    if (!got.doc) { skip(got.error, got.retryable); continue; }
    await coverBranding(got.doc, s.provider);
    try { await replaceBrandText(got.doc, s.provider); }
    catch (e) { console.error("label brand text", s.id, (e as Error).message); } // the courier's label still downloads
    for (const p of await doc.copyPages(got.doc, got.doc.getPageIndices())) doc.addPage(p);
  }

  // ---- lay out the Vishwaship labels
  if (branded.length) {
    const logos = { vs: await img(VISHWASHIP_LOGO), carriers: new Map<LabelLogo, PDFImage>() };
    for (const l of branded) if (l.carrierLogo && !logos.carriers.has(l.carrierLogo)) logos.carriers.set(l.carrierLogo, await img(l.carrierLogo));
    const failed = new Set<string>();
    type Place = { l: BrandedLabel; page: number; box: Box };
    const plan: Place[] = [];
    const invoicePages: Array<{ page: number; sid: string; cut: boolean }> = [];
    let pageNo = -1;
    const pm = fmt.mm!;
    const rotate = !fmt.slots && fmt.group === "thermal" && pm[0] < 60; // narrow rolls: landscape layout on a rotated page
    if (fmt.slots) {
      const [cols, rws] = fmt.slots;
      const per = cols * rws;
      // A4 · 1 label per page: a normal-size label on the top half (a full-page frame would leave the label lost in white space)
      const band = layoutFormat === "a4_1up" ? 148.5 : 297;
      for (let i = 0; i < branded.length; i += per) { pageNo++; gridBoxes(cols, rws, 0, band).slice(0, Math.min(per, branded.length - i)).forEach((box, k) => plan.push({ l: branded[i + k], page: pageNo, box })); }
    } else if (layoutFormat === "a4_fit" || layoutFormat === "a4_doc") {
      // one shipment never shares a sheet with another; its cartons stay together
      const groups = new Map<string, BrandedLabel[]>();
      for (const l of branded) { const sid = brandedOf.get(l)!; groups.set(sid, [...(groups.get(sid) ?? []), l]); }
      for (const [sid, list] of groups) {
        let rest = list;
        if (layoutFormat === "a4_doc") {
          pageNo++;
          const docItem = rest.find((l) => l.kind === "document");
          const top = docItem ? [docItem] : rest.slice(0, 2);
          gridBoxes(top.length, 1, 0, 148.5).forEach((box, k) => plan.push({ l: top[k], page: pageNo, box }));
          invoicePages.push({ page: pageNo, sid, cut: !docItem }); // B2B: document + invoice are stapled together, not cut apart
          rest = rest.filter((l) => !top.includes(l));
        }
        while (rest.length) {
          const chunk = rest.slice(0, 4);
          pageNo++;
          gridBoxes(2, 2, 0, 297).forEach((box, k) => { if (chunk[k]) plan.push({ l: chunk[k], page: pageNo, box }); });
          rest = rest.slice(4);
        }
      }
    } else {
      for (const l of branded) { pageNo++; const w = (rotate ? pm[1] : pm[0]) * PT, h = (rotate ? pm[0] : pm[1]) * PT; plan.push({ l, page: pageNo, box: { x: 0, y: 0, w, h } }); }
    }
    // check every label fits the box it will get before drawing anything (a size that cannot fit is reported, not clipped)
    for (const it of plan) {
      const sid = brandedOf.get(it.l)!;
      if (failed.has(sid)) continue;
      const probe = await PDFDocument.create();
      const pf = { r: await probe.embedFont(StandardFonts.Helvetica), b: await probe.embedFont(StandardFonts.HelveticaBold) };
      const page = probe.addPage([it.box.w, it.box.h]);
      const err = drawBranded(page, pf, { vs: null, carrier: null }, it.l, { x: 0, y: 0, w: it.box.w, h: it.box.h });
      if (err) {
        failed.add(sid);
        const row = rows.find((r) => r.s.id === sid)!;
        const alt = ["thermal_4x6", "a4_2up", "thermal_4x4"].filter((k) => k !== layoutFormat).map((k) => PRINT_FORMATS.find((x) => x.key === k)!.name).join(", ");
        skipped.push({ shipmentId: sid, orderNumber: row.o.orderNumber, reason: `${err} on ${fmt.name}. Use ${alt} instead.`, retryable: false });
      }
    }
    // draw; pages are created on first use so a skipped shipment leaves no blank sheet
    const pdfPages = new Map<number, PDFPage>();
    const pageFor = (n: number) => {
      let pg = pdfPages.get(n);
      if (!pg) {
        pg = fmt.group === "a4" ? doc.addPage([210 * PT, 297 * PT]) : doc.addPage(rotate ? [pm[1] * PT, pm[0] * PT] : [pm[0] * PT, pm[1] * PT]);
        if (rotate) pg.setRotation(degrees(90));
        pdfPages.set(n, pg);
      }
      return pg;
    };
    const keep = plan.filter((it) => !failed.has(brandedOf.get(it.l)!));
    const pagesInOrder = [...new Set([...keep.map((x) => x.page), ...invoicePages.filter((x) => !failed.has(x.sid)).map((x) => x.page)])].sort((x, y) => x - y);
    for (const n of pagesInOrder) {
      const page = pageFor(n);
      for (const it of keep.filter((x) => x.page === n)) {
        // light cut guide around each label on A4 sheets
        if (fmt.group === "a4") page.drawRectangle({ x: it.box.x, y: it.box.y, width: it.box.w, height: it.box.h, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 0.5, borderDashArray: [3, 3] });
        drawBranded(page, fonts, { vs: logos.vs, carrier: it.l.carrierLogo ? logos.carriers.get(it.l.carrierLogo)! : null }, it.l, it.box);
      }
      const invPage = invoicePages.find((x) => x.page === n && !failed.has(x.sid));
      if (invPage) {
        const data = invoices.get(invPage.sid);
        // cut line across the middle, then the invoice on the bottom half
        if (invPage.cut) cutLine(page, fonts.r);
        if (data) drawInvoice(page, fonts, data, LOWER_HALF);
      }
    }
  }
  const pages = doc.getPageCount();
  return { pdf: pages ? await doc.save() : null, pages, labels: branded.length, skipped, notices: [...notices] };
}

/**
 * The courier's own label for a shipment as a separate PDF (one page per page the courier made), or why not.
 * Read-only: asks the courier for the label; never books or charges. Records whether the courier's label works.
 */
async function courierLabel(s: typeof schema.shipments.$inferSelect, carrierFormat: LabelFormat, scans?: PageScan[]): Promise<{ doc: PDFDocument; error?: never; retryable?: never } | { doc: null; error: string; retryable: boolean }> {
  if (!s.awb) return { doc: null, error: "Label pending — the courier has not assigned the AWB / LRN yet", retryable: true };
  const db = await getDb();
  const [acct] = await db.select().from(schema.providerAccounts).where(eq(schema.providerAccounts.id, s.providerAccountId));
  const ad = acct && adapterFor(acct);
  if (!ad) return { doc: null, error: "Courier account unavailable — contact Vishwaship support", retryable: false };
  const ctx = await providerContext(acct);
  const ref = { providerOrderRef: s.providerOrderRef ?? s.id, awb: s.awb };
  let lastErr = "", retryable = true;
  for (let attempt = 0; attempt < 2; attempt++) {
    // a second attempt asks the courier again: label links are short-lived and a fresh request returns new ones
    const r = await ad.label(ctx, ref, carrierFormat);
    if (!r.ok) { lastErr = r.error.message; retryable = r.error.retryable; if (!r.error.retryable) break; continue; }
    if (r.value.html) { lastErr = "This courier's label opens as a web page — use the order page's label link"; retryable = false; break; }
    try {
      // into a scratch file first, so a half-read label never leaves stray pages in the download
      const one = await PDFDocument.create();
      scans?.splice(0);
      if (await placeCarrierLabel(one, r.value, s.provider, scans)) {
        await db.update(schema.shipments).set({ labelStatus: "available" }).where(eq(schema.shipments.id, s.id));
        await noteCapability(acct.id, "label", true, { evidence: `AWB ${s.awb}` });
        return { doc: one };
      }
      lastErr = "The courier returned an empty label";
    } catch (e) {
      lastErr = `Could not read the courier's label: ${(e as Error).message}`.slice(0, 200);
    }
  }
  await noteCapability(acct.id, "label", false, { message: lastErr.slice(0, 200), evidence: `AWB ${s.awb}` });
  return { doc: null, error: lastErr || "The courier label is not available yet", retryable };
}

/** Size of one label: thermal = the roll (landscape for narrow rolls), A4 = one grid slot inside printer-safe margins. */
function slotSize(format: PrintFormat): { w: number; h: number } {
  const f = PRINT_FORMATS.find((p) => p.key === format)!;
  if (f.slots) {
    const [cols, rws] = f.slots;
    return { w: (210 - 2 * A4_MARGIN - (cols - 1) * A4_GAP) / cols, h: (297 - 2 * A4_MARGIN - (rws - 1) * A4_GAP) / rws };
  }
  const [w, h] = f.mm!;
  return w < 60 ? { w: h, h: w } : { w, h };
}

/** Put the courier's label (PNG / JPEG / PDF bytes, base64 text, or HTTPS links) on pages at the courier's own size. */
export async function placeCarrierLabel(doc: PDFDocument, v: { url?: string; pdf?: Uint8Array; images?: string[] }, provider?: string, scans?: PageScan[]): Promise<number> {
  let added = 0;
  const fontsFor = new Map<boolean, PDFFont>();
  const fontFor = async (bold: boolean) => { if (!fontsFor.has(bold)) fontsFor.set(bold, await doc.embedFont(bold ? StandardFonts.HelveticaBold : StandardFonts.Helvetica)); return fontsFor.get(bold)!; };
  const place = async (raw: Uint8Array, depth = 0): Promise<void> => {
    const b = raw;
    const isPng = b[0] === 0x89 && b[1] === 0x50, isJpg = b[0] === 0xff && b[1] === 0xd8, isPdf = b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
    if (isPng || isJpg) {
      const im = isPng ? await doc.embedPng(b) : await doc.embedJpg(b);
      // a courier label is at most 4 in wide: an 812 px thermal render prints at 203 dpi, Delhivery's 400 px images
      // at 100 dpi — never smaller than the courier made it (a half-size label is hard to scan)
      const dpi = Math.max(96, im.width / 4), k = 72 / dpi;
      const page = doc.addPage([im.width * k, im.height * k]);
      page.drawImage(im, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
      if (scans) {
        if (isPng) { const px = decodePng(b); scans.push(scanLabelImage(px.rgba, px.width, px.height)); }
        else scans.push({ codes: [], matrix: null }); // JPEG: not read here
      }
      if (isPng && provider) {
        // our account's name in the image → VISHWASHIP, written over it in the same place (barcodes are elsewhere)
        try {
          const px = decodePng(b);
          for (const h of findBrandInImage(provider, px.rgba, px.width, px.height)) {
            const x = h.x * k, w = h.w * k, ht = h.h * k, y = page.getHeight() - (h.y + h.h) * k;
            page.drawRectangle({ x: x - k, y: y - k, width: w + 2 * k, height: ht + 2 * k, color: rgb(1, 1, 1) });
            const font = await fontFor(h.bold);
            const size = Math.min(ht / 0.72, (ht / 0.72) * (w / font.widthOfTextAtSize(BRAND_REPLACEMENT, ht / 0.72)));
            page.drawText(BRAND_REPLACEMENT, { x, y, size, font, color: rgb(0, 0, 0) });
          }
        } catch (e) { console.error("label image brand", (e as Error).message); }
      }
      added++;
      return;
    }
    if (isPdf) {
      const srcDoc = await PDFDocument.load(b, { ignoreEncryption: true });
      for (const p of await doc.copyPages(srcDoc, srcDoc.getPageIndices())) { doc.addPage(p); added++; }
      if (scans) for (const i of srcDoc.getPageIndices()) scans.push(...labelsOnPage((await pdfPageImages(srcDoc, i)).map((im) => scanLabelImage(im.rgba, im.width, im.height))));
      return;
    }
    const text = Buffer.from(b).toString("utf8").trim().replace(/^"|"$/g, "");
    if (depth < 3 && /^[[{]/.test(text)) {
      // JSON wrapper: { data: [...] } / { label: "base64" } / ["url", ...]
      let j: unknown; try { j = JSON.parse(text); } catch { j = null; }
      const found = labelStrings(j);
      if (found.length) { for (const f of found) await place(Buffer.from(f), depth + 1); return; }
    }
    if (depth < 3 && /^data:[a-z/+.-]+;base64,/i.test(text)) return place(Buffer.from(text.slice(text.indexOf(",") + 1), "base64"), depth + 1);
    if (depth < 3 && /^https:\/\//.test(text)) return place(await fetchBytes(text), depth + 1);
    if (depth < 3 && /^[A-Za-z0-9+/=\s_-]{100,}$/.test(text)) return place(Buffer.from(text.replace(/\s/g, "").replace(/-/g, "+").replace(/_/g, "/"), "base64"), depth + 1);
    throw new Error(`unrecognised label file (starts with ${Buffer.from(b.slice(0, 8)).toString("hex")})`);
  };
  for (const src of v.images ?? []) {
    const m = src.match(/^data:[^,]*,(.*)$/s);
    await place(m ? Buffer.from(m[1], "base64") : /^https:\/\//.test(src) ? await fetchBytes(src) : Buffer.from(src));
  }
  if (v.pdf) await place(v.pdf);
  else if (v.url) await place(await fetchBytes(v.url));
  return added;
}

/**
 * The labels on one courier page, from the scans of its images. A sheet with several labels (Shipmozo's Delhivery B2B
 * file: master carton + "MPS: Documents" on one page) has one waybill barcode image per label, each its own label.
 * Anything else is one label (e.g. a thermal label image carrying the AWB and an order-id barcode).
 */
export function labelsOnPage(images: PageScan[]): PageScan[] {
  const withCode = images.filter((x) => x.codes.length);
  const waybill = (x: PageScan) => x.codes.length === 1 && /^\d{10,}$/.test(x.codes[0].text);
  if (withCode.length >= 2 && withCode.every(waybill) && new Set(withCode.map((x) => x.codes[0].text.length)).size === 1
    && new Set(withCode.map((x) => x.codes[0].text)).size === withCode.length) return withCode.map((x) => ({ codes: x.codes, matrix: null }));
  return [mergeScans(images)];
}

/** 8-bit RGB / grey Flate (or plain) and JPEG images drawn on a PDF page, as RGBA (soft masks applied); others are skipped. */
async function pdfPageImages(doc: PDFDocument, index: number): Promise<Array<{ width: number; height: number; rgba: Uint8Array }>> {
  const out: Array<{ width: number; height: number; rgba: Uint8Array }> = [];
  const look = (v: unknown) => (v instanceof PDFRef ? doc.context.lookup(v) : v);
  const xo = look(doc.getPage(index).node.Resources()?.get(PDFName.of("XObject"))) as PDFDict | undefined;
  if (!xo || !("entries" in xo)) return out;
  const pixels = async (st: PDFRawStream) => {
    const d = st.dict;
    const w = (look(d.get(PDFName.of("Width"))) as { asNumber(): number }).asNumber(), h = (look(d.get(PDFName.of("Height"))) as { asNumber(): number }).asNumber();
    const bpc = (look(d.get(PDFName.of("BitsPerComponent"))) as { asNumber(): number } | undefined)?.asNumber();
    const cs = String(look(d.get(PDFName.of("ColorSpace"))) ?? "");
    const filter = String(look(d.get(PDFName.of("Filter"))) ?? "");
    if (filter === "/DCTDecode") {
      // a JPEG (Shipmozo draws Delhivery's barcodes as JPEG images): decoded to plain pixels
      const sharp = (await import("sharp")).default;
      const { data, info } = await sharp(Buffer.from(st.contents), { limitInputPixels: 25_000_000 }).removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
      return info.width === w && info.height === h ? { w, h, ch: info.channels, data: new Uint8Array(data) } : null;
    }
    if (bpc !== 8 || !["/DeviceRGB", "/DeviceGray"].includes(cs) || !["", "/FlateDecode"].includes(filter) || d.get(PDFName.of("DecodeParms"))) return null;
    const data = decodePDFRawStream(st).decode();
    const ch = cs === "/DeviceRGB" ? 3 : 1;
    return data.length >= w * h * ch ? { w, h, ch, data } : null;
  };
  for (const [, ref] of (xo as unknown as { entries(): Array<[unknown, unknown]> }).entries()) {
    const st = look(ref);
    if (!(st instanceof PDFRawStream) || String(st.dict.get(PDFName.of("Subtype"))) !== "/Image") continue;
    try {
      const im = await pixels(st);
      if (!im) continue;
      const sm = look(st.dict.get(PDFName.of("SMask")));
      const alpha = sm instanceof PDFRawStream ? await pixels(sm) : null;
      const rgba = new Uint8Array(im.w * im.h * 4);
      for (let p = 0; p < im.w * im.h; p++) {
        rgba[p * 4] = im.data[p * im.ch]; rgba[p * 4 + 1] = im.data[p * im.ch + (im.ch > 1 ? 1 : 0)]; rgba[p * 4 + 2] = im.data[p * im.ch + (im.ch > 1 ? 2 : 0)];
        rgba[p * 4 + 3] = alpha && alpha.w === im.w && alpha.h === im.h ? alpha.data[p * alpha.ch] : 255;
      }
      out.push({ width: im.w, height: im.h, rgba });
    } catch { /* an image we cannot read is simply not scanned */ }
  }
  return out;
}

/** HTTPS download of a label link: follows up to 3 redirects (each hop re-checked), PDF / image only, max 10 MB. */
export async function fetchBytes(url: string, hops = 0): Promise<Uint8Array> {
  if (!url.startsWith("https://")) throw new Error("label link is not HTTPS");
  const r = await safeFetch(url, { timeoutMs: 20_000 });
  if ([301, 302, 303, 307, 308].includes(r.status) && hops < 3) {
    const loc = r.headers.get("location");
    if (loc) return fetchBytes(new URL(loc, url).toString(), hops + 1);
  }
  if (r.status === 403 || r.status === 410) throw new Error(`label link expired (${r.status})`);
  if (!r.ok) throw new Error(`download failed (${r.status})`);
  const buf = new Uint8Array(await r.arrayBuffer());
  if (buf.length > 10 * 1024 * 1024) throw new Error("label file too large");
  return buf;
}

// ------------------------------------------------------------------ Vishwaship label drawing

type Box = { x: number; y: number; w: number; h: number };

/**
 * Draws one Vishwaship label into `box` (points, bottom-left origin). Portrait boxes stack the sections; wide boxes
 * (narrow rolls turned landscape, A4 2-up) use two columns. Returns an error instead of clipping when the mandatory
 * text or a readable barcode does not fit.
 */
export function drawBranded(page: PDFPage, f: { r: PDFFont; b: PDFFont }, logos: { vs: PDFImage | null; carrier: PDFImage | null }, d: BrandedLabel, box: Box): string | null {
  if (tableFits(box)) return drawTableLabel(page, f, logos, { ...d, date: d.date ?? "", masterId: d.masterId ?? null }, box);
  const wMm = box.w / PT, hMm = box.h / PT;
  // two columns when the label is wide or short (narrow rolls turned landscape, 4 × 4 in, A4 2-up)
  const landscape = wMm > hMm * 1.25 || (wMm >= 95 && hMm < 125);
  const small = Math.min(wMm, hMm) < 60;
  const pad = (small ? 1.6 : 3) * PT;
  const base = Math.max(MIN_FONT, small ? 5.2 : wMm >= 95 && hMm >= 130 ? 9 : wMm < 80 ? 6.4 : 7.4);
  const LH = small ? 1.1 : 1.18;
  const black = rgb(0, 0, 0);
  // sections into columns
  const cols: Box[] = landscape
    ? [{ x: box.x + pad, y: box.y + pad, w: box.w * 0.5 - pad * 1.5, h: box.h - 2 * pad }, { x: box.x + box.w * 0.5 + pad * 0.5, y: box.y + pad, w: box.w * 0.5 - pad * 1.5, h: box.h - 2 * pad }]
    : [{ x: box.x + pad, y: box.y + pad, w: box.w - 2 * pad, h: box.h - 2 * pad }];
  let err: string | null = null;
  const flow = (col: Box) => {
    let y = col.y + col.h;
    const fits = (need: number) => { if (y - need < col.y - 0.01) { err ??= "Not all mandatory details fit"; return false; } return true; };
    return {
      get y() { return y; },
      gap: (mm: number) => { y -= mm * PT; },
      text: (s: string, size = base, font = f.r, o: { center?: boolean; maxLines?: number; right?: string } = {}) => {
        const lines = wrap(ansi(s), font, size, col.w);
        const shown = o.maxLines ? lines.slice(0, o.maxLines) : lines;
        if (o.maxLines && lines.length > o.maxLines) shown[shown.length - 1] = ellipsize(shown[shown.length - 1], font, size, col.w);
        for (const ln of shown) {
          if (!fits(size * LH)) return;
          y -= size * LH;
          const x = o.center ? col.x + (col.w - font.widthOfTextAtSize(ln, size)) / 2 : col.x;
          page.drawText(ln, { x, y: y + size * 0.22, size, font, color: black });
        }
      },
      pair: (label: string, value: string, size = base) => {
        const lw = f.b.widthOfTextAtSize(`${label} `, size);
        const lines = wrap(ansi(value), f.r, size, col.w - lw);
        lines.forEach((ln, i) => {
          if (!fits(size * LH)) return;
          y -= size * LH;
          if (i === 0) page.drawText(`${label} `, { x: col.x, y: y + size * 0.22, size, font: f.b, color: black });
          page.drawText(ln, { x: col.x + lw, y: y + size * 0.22, size, font: f.r, color: black });
        });
      },
      /** Optional footer text: printed only when it fits completely (never pushes out mandatory details). */
      optional: (variants: string[], size: number) => {
        for (const v of variants) {
          const lines = wrap(ansi(v), f.r, size, col.w);
          if (y - lines.length * size * LH - 2 < col.y) continue;
          y -= 2;
          for (const ln of lines) { y -= size * LH; page.drawText(ln, { x: col.x, y: y + size * 0.22, size, font: f.r, color: black }); }
          return true;
        }
        return false;
      },
      rule: () => { if (!fits(2.4)) return; y -= 1.2; page.drawLine({ start: { x: col.x, y }, end: { x: col.x + col.w, y }, thickness: 0.7, color: black }); y -= 1.2; },
      heading: (s: string) => {
        const size = Math.max(MIN_FONT, base - 1.2);
        const padY = small ? 0.8 : 1.3;
        if (!fits(size + padY * 2 + 1)) return;
        y -= size + padY;
        const tw = f.b.widthOfTextAtSize(s, size);
        page.drawRectangle({ x: col.x, y: y - padY, width: tw + 5, height: size + padY * 2, color: black });
        page.drawText(s, { x: col.x + 2.5, y: y + 0.3, size, font: f.b, color: rgb(1, 1, 1) });
        y -= padY + 0.8;
      },
      barcode: (value: string, heightMm: number) => {
        const { bars, modules } = code128Bars(value);
        const mod = col.w / modules;
        if (mod < MIN_MODULE_MM * PT) { err ??= `The barcode for ${value} is too long to print readably`; return; }
        const h = heightMm * PT;
        if (!fits(h + 1.5)) return;
        y -= h + 1.5;
        for (const [x, wd] of bars) page.drawRectangle({ x: col.x + x * mod, y, width: wd * mod, height: h, color: black });
      },
      header: () => {
        const hh = Math.min((small ? 4.6 : 9) * PT, col.w * 0.16);
        if (!fits(hh + 2)) return;
        y -= hh;
        let vsW = 0;
        if (logos.vs) { vsW = Math.min(col.w * 0.58, (hh * logos.vs.width) / logos.vs.height); const vh = (vsW * logos.vs.height) / logos.vs.width; page.drawImage(logos.vs, { x: col.x, y: y + (hh - vh) / 2, width: vsW, height: vh }); }
        else { vsW = col.w * 0.55; }
        // courier logo smaller, on the right; the courier's name when no approved logo is on file
        // the courier's logo is the secondary mark: at most 55 % of the Vishwaship logo's width
        const ch = hh * 0.62, room = Math.min(col.w - vsW - 4, vsW * 0.55);
        if (logos.carrier) {
          const cw = Math.min(room, (ch * logos.carrier.width) / logos.carrier.height); const chh = (cw * logos.carrier.height) / logos.carrier.width;
          page.drawImage(logos.carrier, { x: col.x + col.w - cw, y: y + (hh - chh) / 2, width: cw, height: chh });
        } else {
          const size = Math.max(MIN_FONT, Math.min(base + 1, ch));
          const name = ellipsize(ansi(d.carrier), f.b, size, room);
          page.drawText(name, { x: col.x + col.w - f.b.widthOfTextAtSize(name, size), y: y + (hh - size) / 2, size, font: f.b, color: black });
        }
        y -= 1.5;
      },
    };
  };

  const deliver = (c: ReturnType<typeof flow>) => {
    c.heading("DELIVER TO");
    c.text(d.to.name ?? "", base + (small ? 0.8 : 2.5), f.b, { maxLines: 2 });
    c.text([d.to.line1, d.to.line2].filter(Boolean).join(", "), base);
    c.text([d.to.city, d.to.state].filter(Boolean).join(", "), base);
    c.text(`PIN ${d.to.pincode ?? ""}`, base + (small ? 2 : 4.5), f.b, { maxLines: 1 });
    if (d.to.mobile) c.text(`Ph ${d.to.mobile}`, base, f.r, { maxLines: 1 });
  };
  const codes = (c: ReturnType<typeof flow>) => {
    c.text(`${d.mode} | ${d.payment} | ${d.service}`.replace(/\s+\|\s+$/, ""), base - 0.5, f.b, { maxLines: 1 });
    c.barcode(d.parentId, small ? 6.5 : hMm > 120 ? 14 : wMm < 80 ? 9 : 11);
    c.text(`${d.idLabel} ${d.parentId}`, base + (small ? 1 : 1.5), f.b, { center: true, maxLines: 1 });
    if (d.cartons > 1 || d.cartonId) {
      c.text(`CARTON ${d.carton} OF ${d.cartons}`, base + 1, f.b, { center: true, maxLines: 1 });
      if (d.cartonId) { c.barcode(d.cartonId, small ? 5.5 : wMm < 80 ? 7.5 : 9); c.text(`Carton ${d.cartonId}`, base, f.b, { center: true, maxLines: 1 }); }
    }
  };
  const from = (c: ReturnType<typeof flow>) => {
    c.heading("SHIP FROM / PICKUP");
    c.text(d.shipper.company, base, f.b, { maxLines: 2 });
    c.pair("GSTIN", d.shipper.gstin || "Not provided", base - 0.5);
    const p = d.shipper.pickup;
    if (p) c.text([p.line1, p.line2, p.city, p.state, p.pincode].filter(Boolean).join(", ") + (p.mobile && !small ? ` | Ph ${p.mobile}` : ""), base - 0.5);
  };
  const details = (c: ReturnType<typeof flow>) => {
    c.pair("Order ID", d.orderNumber, base - 0.5);
    c.pair("Invoice No.", d.invoiceNumber || "-", base - 0.5);
    c.pair("Invoice value", rupees(d.invoicePaise), base - 0.5);
    c.pair("Products", d.products || "-", base - 0.5);
    c.pair("Weight", `${d.weightKg.toFixed(2)} kg${d.cartons > 1 ? ` | ${d.cartons} cartons` : ""}`, base - 0.5);
  };

  const handover = (c: ReturnType<typeof flow>) => {
    if (d.mode === "B2B" && d.kind !== "document") c.optional([B2B_HANDOVER.label(d.carton, d.cartons), B2B_HANDOVER.labelShort(d.carton, d.cartons)], Math.max(MIN_FONT, base - 1));
  };
  if (d.kind === "document") {
    // B2B shipment document: no carton number, all carton ids, the handover instruction in bold at the top
    const docDetails = (c: ReturnType<typeof flow>) => {
      details(c);
      if (d.ewayBill) c.optional([`E-way bill: ${d.ewayBill}`], base - 0.5);
      if (d.cartonIds?.length) c.optional([`Carton IDs: ${d.cartonIds.join(", ")}`, `Carton IDs: ${d.cartonIds.length} (see labels)`], base - 0.5);
    };
    const docCodes = (c: ReturnType<typeof flow>) => {
      c.text(`${d.mode} | ${d.payment} | ${d.service}`, base - 0.5, f.b, { maxLines: 1 });
      c.barcode(d.parentId, small ? 6.5 : hMm > 120 ? 14 : wMm < 80 ? 9 : 11);
      c.text(`${d.idLabel} ${d.parentId}`, base + (small ? 1 : 1.5), f.b, { center: true, maxLines: 1 });
      c.text(`${d.cartons} CARTON${d.cartons > 1 ? "S" : ""}`, base + 1, f.b, { center: true, maxLines: 1 });
    };
    const title = (c: ReturnType<typeof flow>) => {
      c.heading("SHIPMENT DOCUMENT - NOT FOR A CARTON");
      c.optional([B2B_HANDOVER.document, "Staple with the invoice - give to the pickup person"], base);
    };
    if (landscape) {
      const L = flow(cols[0]), R = flow(cols[1]);
      L.header(); L.rule(); title(L); L.rule(); deliver(L); L.rule(); from(L);
      docCodes(R); R.rule(); docDetails(R);
      R.optional([LABEL_TERMS.full, LABEL_TERMS.short], MIN_FONT);
    } else {
      const C = flow(cols[0]);
      C.header(); C.rule(); title(C); C.rule(); deliver(C); C.rule(); docCodes(C); C.rule(); from(C); C.rule(); docDetails(C);
      C.optional([LABEL_TERMS.full, LABEL_TERMS.short], Math.max(MIN_FONT, base - 2.2));
    }
    return err;
  }

  if (landscape) {
    const L = flow(cols[0]), R = flow(cols[1]);
    if (d.demo) L.text("DEMO LABEL - NOT FOR HANDOVER", base - 0.5, f.b, { maxLines: 1 });
    L.header(); L.rule(); deliver(L); L.rule(); from(L);
    codes(R); R.rule(); details(R); handover(R);
    if (!R.optional([LABEL_TERMS.full, LABEL_TERMS.short], MIN_FONT)) L.optional([LABEL_TERMS.short], MIN_FONT);
  } else {
    const C = flow(cols[0]);
    if (d.demo) C.text("DEMO LABEL - NOT FOR CARRIER HANDOVER", base - 0.5, f.b, { center: true, maxLines: 1 });
    C.header(); C.rule(); deliver(C); C.rule(); codes(C); C.rule(); from(C); C.rule(); details(C); handover(C);
    C.optional([LABEL_TERMS.full, LABEL_TERMS.short], Math.max(MIN_FONT, base - 2.2));
  }
  return err;
}

function ellipsize(s: string, font: PDFFont, size: number, max: number) {
  if (font.widthOfTextAtSize(s, size) <= max) return s;
  let t = s; while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, size) > max) t = t.slice(0, -1);
  return `${t}...`;
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
