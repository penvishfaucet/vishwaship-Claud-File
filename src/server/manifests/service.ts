import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { and, desc, eq, gte, inArray, isNotNull, lt, ne } from "drizzle-orm";
import { PDFDocument, type PDFFont, type PDFImage, type PDFPage, StandardFonts, rgb } from "pdf-lib";
import { getDb, schema } from "@/server/db/client";
import { newKey, putPrivate } from "@/server/storage";
import { newId } from "@/server/util/ids";
import { COMPANY_DEFAULT } from "@/server/billing";

export type ManifestRow = { shipmentId: string; awb: string; orderNumber: string; receiver: string; city: string; pincode: string; boxes: number };
export type ManifestGroup = { carrier: string; pickup: { label: string; address: string }; rows: ManifestRow[] };
export class ManifestError extends Error { constructor(public status: number, message: string) { super(message); } }

/** Start / end of a calendar day in India (Asia/Kolkata, UTC+5:30, no DST). */
export function istDayRange(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ManifestError(422, "Choose a valid date");
  const [y, m, d] = date.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, d) - 5.5 * 3600_000);
  return { start, end: new Date(start.getTime() + 86400_000) };
}
export const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const istNow = () => new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });
const fmtDate = (d: string) => new Date(`${d}T12:00:00+05:30`).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });

/** Eligible shipments → groups: one per courier partner, then per pickup location; ordered for printing. */
async function collect(orgId: string, where: { date?: string; shipmentId?: string; carrierCode?: string; warehouseId?: string }) {
  const db = await getDb();
  const S = schema.shipments, O = schema.orders;
  const conds = [eq(S.orgId, orgId), isNotNull(S.awb), ne(S.status, "cancelled"), ne(S.bookingStatus, "failed")];
  if (where.shipmentId) conds.push(eq(S.id, where.shipmentId));
  if (where.date) { const r = istDayRange(where.date); conds.push(gte(S.createdAt, r.start), lt(S.createdAt, r.end)); }
  if (where.carrierCode) conds.push(eq(S.carrierCode, where.carrierCode));
  if (where.warehouseId) conds.push(eq(O.warehouseId, where.warehouseId));
  const rows = await db.select({ s: S, o: O }).from(S).innerJoin(O, eq(O.id, S.orderId)).where(and(...conds)).orderBy(S.createdAt);
  const pk = rows.length ? await db.select().from(schema.packages).where(inArray(schema.packages.orderId, rows.map((r) => r.o.id))) : [];
  const groups = new Map<string, ManifestGroup>();
  for (const { s, o } of rows) {
    const snap = (o.pickupSnapshot ?? {}) as { label?: string; line1?: string; line2?: string; city?: string; state?: string; pincode?: string };
    const pickup = { label: snap.label ?? "Pickup address", address: [snap.line1, snap.line2, snap.city, snap.state, snap.pincode].filter(Boolean).join(", ") };
    const key = `${s.carrierName}|${o.warehouseId ?? pickup.label}`;
    const c = o.consignee as { name?: string; city?: string; pincode?: string };
    const boxes = pk.filter((p) => p.orderId === o.id).reduce((t, p) => t + p.count, 0) || (Array.isArray(s.pieceIds) ? (s.pieceIds as unknown[]).length : 0) || 1;
    if (!groups.has(key)) groups.set(key, { carrier: s.carrierName, pickup, rows: [] });
    groups.get(key)!.rows.push({ shipmentId: s.id, awb: s.awb!, orderNumber: o.orderNumber, receiver: c.name ?? "", city: c.city ?? "", pincode: c.pincode ?? "", boxes });
  }
  return [...groups.values()].sort((a, b) => a.carrier.localeCompare(b.carrier) || a.pickup.label.localeCompare(b.pickup.label));
}

// ------------------------------------------------------------------ PDF (A4, black-and-white friendly)

const A4 = { w: 595.28, h: 841.89 }, M = 36;
const BLACK = rgb(0, 0, 0), GREY = rgb(0.35, 0.35, 0.35), LINE = rgb(0.55, 0.55, 0.55);
/** Standard PDF fonts only print Latin-1: anything else becomes "?". */
const latin = (s: string) => (s ?? "").replace(/₹/g, "Rs.").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, "-").replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
function fit(text: string, font: PDFFont, size: number, width: number) {
  let t = latin(text);
  if (font.widthOfTextAtSize(t, size) <= width) return t;
  while (t.length > 1 && font.widthOfTextAtSize(`${t}…`.replace("…", "..."), size) > width) t = t.slice(0, -1);
  return `${t}...`;
}
function wrap(text: string, font: PDFFont, size: number, width: number) {
  const words = latin(text).split(/\s+/); const lines: string[] = []; let cur = "";
  for (const w of words) { const next = cur ? `${cur} ${w}` : w; if (font.widthOfTextAtSize(next, size) > width && cur) { lines.push(cur); cur = w; } else cur = next; }
  if (cur) lines.push(cur);
  return lines;
}

let logoCache: Uint8Array | null | undefined;
async function logoBytes() {
  if (logoCache !== undefined) return logoCache;
  try {
    const raw = await readFile(join(process.cwd(), "public", "brand", "vishwaship-logo-transparent.png"));
    try { const sharp = (await import("sharp")).default; logoCache = new Uint8Array(await sharp(raw).resize({ width: 520 }).png().toBuffer()); }
    catch { logoCache = new Uint8Array(raw); }
  } catch { logoCache = null; }
  return logoCache;
}

const COLS = [
  { key: "sn", title: "S.No", w: 30 }, { key: "awb", title: "AWB number", w: 104 }, { key: "order", title: "Order ID", w: 92 },
  { key: "recv", title: "Receiver", w: 104 }, { key: "dest", title: "Destination (city, PIN)", w: 104 }, { key: "boxes", title: "Boxes", w: 36 }, { key: "ok", title: "Handed over", w: 53 },
] as const;

export async function renderManifestPdf(m: { manifestNo: string; bookingDate: string; generatedAt: string; sender: string; groups: ManifestGroup[];
  company: { legalName: string; address: string; gstin: string; email: string; phone: string } }) {
  const doc = await PDFDocument.create();
  doc.setTitle(`Shipment Pickup Manifest ${m.manifestNo}`); doc.setAuthor(m.company.legalName); doc.setCreator("vishwaship.com");
  const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const lb = await logoBytes(); let logo: PDFImage | null = null;
  if (lb) try { logo = await doc.embedPng(lb); } catch { logo = null; }

  const text = (p: PDFPage, s: string, x: number, y: number, size = 9, f: PDFFont = font, color = BLACK) => p.drawText(latin(s), { x, y, size, font: f, color });
  const box = (p: PDFPage, x: number, y: number, w: number, h: number, thick = 0.8) => p.drawRectangle({ x, y, width: w, height: h, borderColor: BLACK, borderWidth: thick });
  const field = (p: PDFPage, label: string, x: number, y: number, w: number) => { text(p, label, x, y + 3, 8.5, font, GREY); p.drawLine({ start: { x: x + font.widthOfTextAtSize(latin(label), 8.5) + 4, y: y + 1 }, end: { x: x + w, y: y + 1 }, thickness: 0.6, color: LINE }); };

  /** Page header; full on the first page of a section, compact (with "continued") after. Returns the next y. */
  function header(p: PDFPage, g: ManifestGroup, cont: boolean) {
    let y = A4.h - M;
    if (logo) { const h = 30, w = (logo.width / logo.height) * h; p.drawImage(logo, { x: M - 4, y: y - h + 4, width: w, height: h }); }
    const cx = A4.w - M;
    const right = [m.company.legalName, m.company.address, m.company.gstin ? `GSTIN: ${m.company.gstin}` : "", [m.company.phone, m.company.email].filter(Boolean).join(" | ")].filter(Boolean);
    right.forEach((line, i) => { const s = i === 0 ? 9.5 : 7.5; const f = i === 0 ? bold : font; const t = fit(line, f, s, 300); p.drawText(t, { x: cx - f.widthOfTextAtSize(t, s), y: y - 6 - i * 10, size: s, font: f, color: BLACK }); });
    y -= 48;
    p.drawLine({ start: { x: M, y }, end: { x: A4.w - M, y }, thickness: 1.2, color: BLACK });
    y -= 20;
    const title = cont ? "SHIPMENT PICKUP MANIFEST (continued)" : "SHIPMENT PICKUP MANIFEST";
    p.drawText(title, { x: (A4.w - bold.widthOfTextAtSize(title, 14)) / 2, y, size: 14, font: bold, color: BLACK });
    y -= 10;
    const info: Array<[string, string]> = cont
      ? [["Manifest ID", m.manifestNo], ["Courier partner", g.carrier], ["Pickup location", g.pickup.label], ["Booking date", fmtDate(m.bookingDate)]]
      : [["Manifest ID", m.manifestNo], ["Booking date", fmtDate(m.bookingDate)], ["Courier partner", g.carrier], ["Generated (IST)", m.generatedAt], ["Sender", m.sender], ["Pickup location", g.pickup.label]];
    const rows = Math.ceil(info.length / 2), rh = 15, bh = rows * rh + 8 + (cont ? 0 : 26);
    box(p, M, y - bh, A4.w - 2 * M, bh);
    info.forEach(([k, v], i) => {
      const col = i % 2, r = Math.floor(i / 2), x = M + 8 + col * ((A4.w - 2 * M) / 2), yy = y - 14 - r * rh;
      text(p, `${k}:`, x, yy, 8.5, font, GREY); text(p, fit(v, k === "Manifest ID" || k === "Courier partner" ? bold : font, 9, 170), x + 78, yy, 9, k === "Manifest ID" || k === "Courier partner" ? bold : font);
    });
    if (!cont) { const ay = y - 14 - rows * rh; text(p, "Pickup address:", M + 8, ay, 8.5, font, GREY); wrap(g.pickup.address, font, 8.5, A4.w - 2 * M - 100).slice(0, 2).forEach((l, i) => text(p, l, M + 86, ay - i * 11, 8.5)); }
    return y - bh - 14;
  }
  function tableHead(p: PDFPage, y: number) {
    p.drawRectangle({ x: M, y: y - 18, width: A4.w - 2 * M, height: 18, color: rgb(0.88, 0.88, 0.88), borderColor: BLACK, borderWidth: 0.8 });
    let x = M; for (const c of COLS) { text(p, c.title, x + 3, y - 12.5, 8, bold); x += c.w; }
    return y - 18;
  }
  const RH = 18;
  const BLOCK_H = 300; // totals + exceptions + statement + both signature blocks

  for (const g of m.groups) {
    let page = doc.addPage([A4.w, A4.h]);
    let y = header(page, g, false);
    y = tableHead(page, y);
    g.rows.forEach((r, i) => {
      if (y - RH < M + 30) { page = doc.addPage([A4.w, A4.h]); y = header(page, g, true); y = tableHead(page, y); }
      const vals = [String(i + 1), r.awb, r.orderNumber, r.receiver, `${r.city}${r.city && r.pincode ? ", " : ""}${r.pincode}`, String(r.boxes), ""];
      let x = M;
      COLS.forEach((c, ci) => { page.drawRectangle({ x, y: y - RH, width: c.w, height: RH, borderColor: LINE, borderWidth: 0.6 }); if (vals[ci]) text(page, fit(vals[ci], ci === 1 ? bold : font, 8.5, c.w - 6), x + 3, y - 12.5, 8.5, ci === 1 ? bold : font); x += c.w; });
      // empty tick box in the last column
      const tx = M + COLS.slice(0, 6).reduce((t, c) => t + c.w, 0) + 19; page.drawRectangle({ x: tx, y: y - 14, width: 11, height: 11, borderColor: BLACK, borderWidth: 0.8 });
      y -= RH;
    });
    if (y - BLOCK_H < M + 24) { page = doc.addPage([A4.w, A4.h]); y = header(page, g, true); }
    y -= 12;
    const W = A4.w - 2 * M;
    // totals
    const awbs = g.rows.length, boxes = g.rows.reduce((t, r) => t + r.boxes, 0);
    box(page, M, y - 40, W, 40);
    text(page, `Total AWBs listed: ${awbs}`, M + 8, y - 15, 10, bold); text(page, `Total boxes listed: ${boxes}`, M + 8, y - 31, 10, bold);
    field(page, "Actual AWBs handed over:", M + W / 2, y - 16, W / 2 - 10); field(page, "Actual boxes handed over:", M + W / 2, y - 32, W / 2 - 10);
    y -= 52;
    // exceptions
    box(page, M, y - 62, W, 62);
    text(page, "Exceptions - AWBs or boxes left behind, count differences, other pickup remarks:", M + 8, y - 13, 8.5, bold);
    for (let i = 0; i < 3; i++) page.drawLine({ start: { x: M + 8, y: y - 28 - i * 13 }, end: { x: M + W - 8, y: y - 28 - i * 13 }, thickness: 0.5, color: LINE });
    y -= 74;
    // acknowledgement statement
    wrap("\"I acknowledge receipt of the parcels marked as handed over on this manifest. The actual parcel count and any exceptions are recorded above.\"", bold, 9, W).forEach((l, i) => text(page, l, M, y - i * 12, 9, bold));
    y -= 30;
    // signature blocks
    const half = (W - 12) / 2, bh = 128;
    box(page, M, y - bh, half, bh); box(page, M + half + 12, y - bh, half, bh);
    text(page, "PICKUP CONFIRMATION (courier)", M + 8, y - 14, 9, bold);
    field(page, "Actual pickup date & time:", M + 8, y - 34, half - 16);
    field(page, "Executive full name:", M + 8, y - 56, half - 16);
    field(page, "Signature:", M + 8, y - 84, half - 16);
    field(page, "Courier staff ID (if any):", M + 8, y - 110, half - 16);
    const sx = M + half + 20;
    text(page, "SENDER CONFIRMATION", sx, y - 14, 9, bold);
    field(page, "Authorised sender name:", sx, y - 34, half - 16);
    field(page, "Signature:", sx, y - 58, half - 110);
    page.drawRectangle({ x: M + W - 96, y: y - bh + 8, width: 88, height: 70, borderColor: BLACK, borderWidth: 1, borderDashArray: [3, 2] });
    text(page, "Company Stamp", M + W - 88, y - bh + 40, 8.5, bold, GREY);
  }
  // footer: page x of y
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const t = `${m.manifestNo}  |  Page ${i + 1} of ${pages.length}  |  Generated ${m.generatedAt} IST via vishwaship.com`;
    p.drawText(latin(t), { x: (A4.w - font.widthOfTextAtSize(latin(t), 7.5)) / 2, y: 20, size: 7.5, font, color: GREY });
  });
  return doc.save();
}

// ------------------------------------------------------------------ generate / store

async function companyDetails() {
  const { getSetting } = await import("@/server/quotes/service");
  const { t } = await import("@/server/content");
  const co = (await getSetting("company_billing", COMPANY_DEFAULT)).value as typeof COMPANY_DEFAULT;
  return { legalName: co.legalName || "Vishwaship", address: co.address || "", gstin: co.gstin || "", email: co.email || "", phone: await t("portal.support.phone").catch(() => "") };
}

async function nextManifestNo(date: string) {
  const db = await getDb();
  for (let i = 0; i < 5; i++) {
    const no = `MF${date.replace(/-/g, "").slice(2)}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const [hit] = await db.select({ id: schema.manifests.id }).from(schema.manifests).where(eq(schema.manifests.manifestNo, no));
    if (!hit) return no;
  }
  throw new ManifestError(500, "Could not allocate a Manifest ID, try again");
}

/** Generate (always a new Manifest ID), store the PDF privately and record the exact AWB list. */
export async function generateManifest(a: { orgId: string; userId: string; scope: "daily" | "shipment"; date?: string; shipmentId?: string; carrierCode?: string; warehouseId?: string }) {
  const db = await getDb();
  let bookingDate = a.date ?? istToday();
  if (a.scope === "shipment") {
    if (!a.shipmentId) throw new ManifestError(422, "Choose a shipment");
    const [s] = await db.select({ createdAt: schema.shipments.createdAt, awb: schema.shipments.awb, status: schema.shipments.status }).from(schema.shipments).where(and(eq(schema.shipments.id, a.shipmentId), eq(schema.shipments.orgId, a.orgId)));
    if (!s) throw new ManifestError(404, "Shipment not found");
    if (!s.awb) throw new ManifestError(409, "The manifest is available once the courier assigns the AWB");
    if (s.status === "cancelled") throw new ManifestError(409, "This shipment is cancelled");
    bookingDate = new Date(s.createdAt.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
  }
  const groups = await collect(a.orgId, a.scope === "shipment" ? { shipmentId: a.shipmentId } : { date: bookingDate, carrierCode: a.carrierCode, warehouseId: a.warehouseId });
  if (!groups.length) throw new ManifestError(404, a.scope === "daily" ? `No booked shipments with an AWB on ${fmtDate(bookingDate)}${a.carrierCode || a.warehouseId ? " for these filters" : ""}` : "Nothing to put on the manifest");
  const [org] = await db.select({ name: schema.orgs.businessName }).from(schema.orgs).where(eq(schema.orgs.id, a.orgId));
  const manifestNo = await nextManifestNo(bookingDate);
  const pdf = await renderManifestPdf({ manifestNo, bookingDate, generatedAt: istNow(), sender: org?.name ?? "", groups, company: await companyDetails() });
  const id = newId("mf");
  const key = newKey(`manifests/${a.orgId.replace(/[^a-z0-9_-]/gi, "").toLowerCase()}`, "pdf");
  await putPrivate(key, Buffer.from(pdf));
  const awbCount = groups.reduce((t, g) => t + g.rows.length, 0), boxCount = groups.reduce((t, g) => t + g.rows.reduce((u, r) => u + r.boxes, 0), 0);
  await db.insert(schema.manifests).values({ id, orgId: a.orgId, manifestNo, scope: a.scope, bookingDate, filters: { carrierCode: a.carrierCode ?? null, warehouseId: a.warehouseId ?? null, shipmentId: a.shipmentId ?? null }, groups, awbCount, boxCount, pdfKey: key, createdBy: a.userId });
  return { id, manifestNo, awbCount, boxCount, couriers: [...new Set(groups.map((g) => g.carrier))] };
}

export async function listManifests(orgId: string, limit = 100) {
  const db = await getDb();
  return db.select().from(schema.manifests).where(eq(schema.manifests.orgId, orgId)).orderBy(desc(schema.manifests.createdAt)).limit(limit);
}
