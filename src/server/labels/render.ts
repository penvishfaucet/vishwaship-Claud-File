import "server-only";
import { PDFDocument, type PDFFont, type PDFImage, type PDFPage, StandardFonts, degrees, rgb } from "pdf-lib";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { adapterFor, providerContext } from "@/server/providers/registry";
import { safeFetch } from "@/server/security/safe-fetch";
import { code128Bars } from "@/lib/code128";
import { LABEL_TERMS, type PrintFormat, PRINT_FORMATS } from "@/lib/order-view";
import { CARRIER_POLICY, labelSource } from "./formats";
import { CARRIER_LOGOS, type LabelLogo, VISHWASHIP_LOGO } from "./logos.generated";
import { noteCapability } from "@/server/carriers/verification";
import { labelStrings } from "./strings";
import { orgSetting } from "@/server/couriers";

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
      const isB2B = o.mode === "B2B" || s.provider === "delhivery_b2b";
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
      for (let i = 0; i < cartons; i++) {
        const l: BrandedLabel = {
          demo: s.provider === "demo", carrier: s.carrierName, carrierLogo: logo, mode: o.mode, service: s.serviceName,
          payment: o.paymentType === "cod" ? "COD" : o.paymentType === "fod" ? "FOD" : "PREPAID",
          idLabel: isB2B ? "LRN" : "AWB", parentId: s.lrNumber && isB2B ? s.lrNumber : s.awb, carton: i + 1, cartons,
          cartonId: pieceIds[i] && pieceIds[i] !== (s.lrNumber ?? s.awb) ? pieceIds[i] : null,
          to: o.consignee as Addr,
          // the shipping customer's own company and GSTIN — never Vishwaship's
          shipper: { company: inv(org.id).businessName || org.businessName, gstin: inv(org.id).gstin || org.gstin || null, pickup },
          orderNumber: o.orderNumber, invoiceNumber: o.invoiceNumber ?? null, invoicePaise: meta.grandTotalPaise ?? o.declaredValuePaise,
          products: productLine(products), weightKg: s.chargeableWeightGrams / 1000,
        };
        branded.push(l); brandedOf.set(l, s.id);
      }
      continue;
    }

    // ---- Carrier label (courier's original, untouched)
    if (o.paymentType === "cod") notices.add("Carrier labels show the COD amount because the courier prints it on its own label. The Vishwaship label never shows it.");
    const [acct] = await db.select().from(schema.providerAccounts).where(eq(schema.providerAccounts.id, s.providerAccountId));
    const ad = acct && adapterFor(acct);
    if (!ad) { skip("Courier account unavailable — contact Vishwaship support"); continue; }
    const ctx = await providerContext(acct);
    const ref = { providerOrderRef: s.providerOrderRef ?? s.id, awb: s.awb };
    let added = 0, lastErr = "";
    for (let attempt = 0; attempt < 2 && !added; attempt++) {
      // a second attempt asks the courier again: label links are short-lived and a fresh request returns new ones
      const r = await ad.label(ctx, ref, src.carrierFormat);
      if (!r.ok) { lastErr = r.error.message; if (!r.error.retryable) break; continue; }
      if (r.value.html) { lastErr = "This courier's label opens as a web page — use the order page's label link"; break; }
      try {
        added = await placeCarrierLabel(doc, r.value);
        if (!added) lastErr = "The courier returned an empty label";
      } catch (e) {
        lastErr = `Could not read the courier's label: ${(e as Error).message}`.slice(0, 200);
      }
    }
    if (added) {
      await db.update(schema.shipments).set({ labelStatus: "available" }).where(eq(schema.shipments.id, s.id));
      await noteCapability(acct.id, "label", true, { evidence: `AWB ${s.awb}` });
    } else {
      await noteCapability(acct.id, "label", false, { message: lastErr.slice(0, 200), evidence: `AWB ${s.awb}` });
      skip(lastErr || "The courier label is not available yet", true);
    }
  }

  // ---- lay out the Vishwaship labels
  if (branded.length) {
    const logos = { vs: await img(VISHWASHIP_LOGO), carriers: new Map<LabelLogo, PDFImage>() };
    for (const l of branded) if (l.carrierLogo && !logos.carriers.has(l.carrierLogo)) logos.carriers.set(l.carrierLogo, await img(l.carrierLogo));
    const failed = new Set<string>();
    const ok: BrandedLabel[] = [];
    // check every label fits its slot before placing any page (so a size that cannot fit is reported, not clipped)
    const slotMm = slotSize(layoutFormat);
    for (const l of branded) {
      const sid = brandedOf.get(l)!;
      if (failed.has(sid)) continue;
      const probe = await PDFDocument.create();
      const pf = { r: await probe.embedFont(StandardFonts.Helvetica), b: await probe.embedFont(StandardFonts.HelveticaBold) };
      const page = probe.addPage([slotMm.w * PT, slotMm.h * PT]);
      const err = drawBranded(page, pf, { vs: null, carrier: null }, l, { x: 0, y: 0, w: slotMm.w * PT, h: slotMm.h * PT });
      if (err) {
        failed.add(sid);
        const row = rows.find((r) => r.s.id === sid)!;
        const alt = ["thermal_4x6", "a4_2up", "thermal_4x4"].filter((k) => k !== layoutFormat).map((k) => PRINT_FORMATS.find((x) => x.key === k)!.name).join(", ");
        skipped.push({ shipmentId: sid, orderNumber: row.o.orderNumber, reason: `${err} on ${fmt.name}. Use ${alt} instead.`, retryable: false });
      } else ok.push(l);
    }
    const placed = ok.filter((l) => !failed.has(brandedOf.get(l)!));
    if (fmt.slots) {
      const [cols, rws] = fmt.slots;
      const per = cols * rws;
      for (let i = 0; i < placed.length; i += per) {
        const page = doc.addPage([210 * PT, 297 * PT]);
        placed.slice(i, i + per).forEach((l, k) => {
          const c = k % cols, r = Math.floor(k / cols);
          const x = (A4_MARGIN + c * (slotMm.w + A4_GAP)) * PT, yTop = (297 - A4_MARGIN - r * (slotMm.h + A4_GAP)) * PT;
          const box = { x, y: yTop - slotMm.h * PT, w: slotMm.w * PT, h: slotMm.h * PT };
          // light cut guide around each label
          page.drawRectangle({ x: box.x, y: box.y, width: box.w, height: box.h, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 0.5, borderDashArray: [3, 3] });
          drawBranded(page, fonts, { vs: logos.vs, carrier: l.carrierLogo ? logos.carriers.get(l.carrierLogo)! : null }, l, box);
        });
      }
    } else {
      const pm = fmt.mm!;
      const rotate = pm[0] < 60; // narrow rolls: landscape layout on a rotated page, so the barcode runs along the long side
      for (const l of placed) {
        const page = doc.addPage(rotate ? [pm[1] * PT, pm[0] * PT] : [pm[0] * PT, pm[1] * PT]);
        if (rotate) page.setRotation(degrees(90));
        drawBranded(page, fonts, { vs: logos.vs, carrier: l.carrierLogo ? logos.carriers.get(l.carrierLogo)! : null }, l, { x: 0, y: 0, w: page.getWidth(), h: page.getHeight() });
      }
    }
  }
  const pages = doc.getPageCount();
  return { pdf: pages ? await doc.save() : null, pages, labels: branded.length, skipped, notices: [...notices] };
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
export async function placeCarrierLabel(doc: PDFDocument, v: { url?: string; pdf?: Uint8Array; images?: string[] }): Promise<number> {
  let added = 0;
  const place = async (raw: Uint8Array, depth = 0): Promise<void> => {
    const b = raw;
    const isPng = b[0] === 0x89 && b[1] === 0x50, isJpg = b[0] === 0xff && b[1] === 0xd8, isPdf = b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
    if (isPng || isJpg) {
      const im = isPng ? await doc.embedPng(b) : await doc.embedJpg(b);
      // carrier label images are 203 dpi thermal renders: keep their physical size
      const page = doc.addPage([(im.width / 203) * 72, (im.height / 203) * 72]);
      page.drawImage(im, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
      added++;
      return;
    }
    if (isPdf) {
      const srcDoc = await PDFDocument.load(b, { ignoreEncryption: true });
      for (const p of await doc.copyPages(srcDoc, srcDoc.getPageIndices())) { doc.addPage(p); added++; }
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

  if (landscape) {
    const L = flow(cols[0]), R = flow(cols[1]);
    if (d.demo) L.text("DEMO LABEL - NOT FOR HANDOVER", base - 0.5, f.b, { maxLines: 1 });
    L.header(); L.rule(); deliver(L); L.rule(); from(L);
    codes(R); R.rule(); details(R);
    if (!R.optional([LABEL_TERMS.full, LABEL_TERMS.short], MIN_FONT)) L.optional([LABEL_TERMS.short], MIN_FONT);
  } else {
    const C = flow(cols[0]);
    if (d.demo) C.text("DEMO LABEL - NOT FOR CARRIER HANDOVER", base - 0.5, f.b, { center: true, maxLines: 1 });
    C.header(); C.rule(); deliver(C); C.rule(); codes(C); C.rule(); from(C); C.rule(); details(C);
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
