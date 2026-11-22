import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { PDFDocument, type PDFFont, type PDFPage, StandardFonts, rgb } from "pdf-lib";
import { getDb, schema } from "@/server/db/client";
import { autoAssign } from "@/server/auto-assign";
import { bookOrder } from "@/server/booking/service";
import { hideProviders } from "@/server/customer-safe";
import { ensureShippingOrder, type Line } from "./checkout";
import { listStoreOrders, type StoreOrderView } from "./orders";
import { logOrderEvent } from "./stock";

/**
 * Packing & Dispatch. The queue is every accepted order that has not left the warehouse yet: "To pack" (no courier
 * booked) and "Ready to ship" (booked, waiting for pickup). From here the merchant prints packing slips and a pick
 * list (these change nothing), and "Pack & book" confirms packing, books a courier where none is booked yet (the
 * account's Auto-Assign rules, else the cheapest serviceable courier) and hands back the shipments whose labels can be
 * downloaded. Booking reuses the normal flow, so a retry never makes a second AWB or a second wallet charge.
 */
export const istDay = (d: Date) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
export const todayIst = () => istDay(new Date());

export type QueueFilter = { view?: string; payment?: string; courier?: string; q?: string };
export const QUEUE_VIEWS = [
  { key: "today", label: "To pack today" },
  { key: "overdue", label: "Overdue" },
  { key: "ready", label: "Ready to ship" },
  { key: "all", label: "All waiting" },
] as const;

/** Orders waiting to leave the warehouse, oldest first. */
export async function dispatchQueue(orgId: string, f: QueueFilter) {
  const [toPack, ready] = await Promise.all([listStoreOrders(orgId, { tab: "to_pack", q: f.q }), listStoreOrders(orgId, { tab: "ready", q: f.q })]);
  const today = todayIst();
  const day = (o: StoreOrderView) => istDay(o.acceptedAt ?? o.placedAt ?? o.createdAt);
  let rows = [...toPack, ...ready];
  const counts = {
    today: toPack.filter((o) => day(o) === today).length, overdue: toPack.filter((o) => day(o) < today).length, ready: ready.length, all: rows.length,
  };
  const view = QUEUE_VIEWS.find((v) => v.key === f.view)?.key ?? "today";
  if (view === "today") rows = toPack.filter((o) => day(o) === today);
  if (view === "overdue") rows = toPack.filter((o) => day(o) < today);
  if (view === "ready") rows = ready;
  if (f.payment === "cod") rows = rows.filter((o) => o.paymentMethod === "cod");
  if (f.payment === "prepaid") rows = rows.filter((o) => o.paymentMethod !== "cod");
  const couriers = [...new Set(ready.map((o) => o.carrierName).filter((c): c is string => !!c))].sort();
  if (f.courier) rows = rows.filter((o) => o.carrierName === f.courier);
  rows.sort((a, b) => (a.acceptedAt ?? a.createdAt).getTime() - (b.acceptedAt ?? b.createdAt).getTime());
  return { rows, counts, couriers, view, today };
}

async function ordersFor(orgId: string, ids: string[]) {
  const db = await getDb();
  const uniq = [...new Set(ids)].slice(0, 200);
  if (!uniq.length) return [];
  const rows = await db.select().from(schema.storeOrders).where(and(eq(schema.storeOrders.orgId, orgId), inArray(schema.storeOrders.id, uniq)));
  const pos = new Map(uniq.map((id, i) => [id, i]));
  return rows.sort((a, b) => pos.get(a.id)! - pos.get(b.id)!);
}

// ---------------------------------------------------------------- PDFs
const A4 = { w: 595.28, h: 841.89 }, M = 32;
const INK = rgb(0.04, 0.17, 0.42), GREY = rgb(0.38, 0.4, 0.46), LINE = rgb(0.8, 0.82, 0.86);
/** Standard PDF fonts only know Latin-1: ₹ and smart quotes are spelt out, anything else becomes "?". */
const latin = (s: string) => (s ?? "").replace(/₹/g, "Rs.").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[–—]/g, "-").replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
function fit(s: string, f: PDFFont, size: number, w: number) {
  let t = latin(s);
  if (f.widthOfTextAtSize(t, size) <= w) return t;
  while (t.length > 1 && f.widthOfTextAtSize(`${t}...`, size) > w) t = t.slice(0, -1);
  return `${t}...`;
}
function wrap(s: string, f: PDFFont, size: number, w: number) {
  const out: string[] = []; let cur = "";
  for (const word of latin(s).split(/\s+/)) {
    const next = cur ? `${cur} ${word}` : word;
    if (f.widthOfTextAtSize(next, size) > w && cur) { out.push(cur); cur = word; } else cur = next;
  }
  if (cur) out.push(cur);
  return out;
}
const ist = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
type Buyer = { name: string; mobile: string; line1: string; line2?: string; city: string; state: string; pincode: string };

/**
 * One packing slip per order, two to an A4 sheet (cut along the middle). Long orders take a whole sheet.
 * Shows what to put in the box (SKU, product, option, qty, a tick box per line) and where it goes.
 */
export async function packingSlipsPdf(orgId: string, ids: string[]) {
  const db = await getDb();
  const orders = (await ordersFor(orgId, ids)).filter((o) => o.status === "placed" && o.acceptance === "accepted");
  if (!orders.length) return null;
  const [store] = await db.select({ name: schema.stores.name }).from(schema.stores).where(eq(schema.stores.id, orders[0].storeId));
  const doc = await PDFDocument.create();
  doc.setTitle(orders.length === 1 ? `Packing slip ${orders[0].number}` : `Packing slips (${orders.length})`); doc.setCreator("vishwaship.com");
  const r = await doc.embedFont(StandardFonts.Helvetica), b = await doc.embedFont(StandardFonts.HelveticaBold);
  let page: PDFPage | null = null, slot = 0;
  const HALF = A4.h / 2;
  for (const o of orders) {
    const lines = o.lines as Line[];
    const big = lines.length > 7;
    if (!page || big || slot >= 2) { page = doc.addPage([A4.w, A4.h]); slot = 0; }
    const top = A4.h - slot * HALF - M, bottom = big ? M : A4.h - (slot + 1) * HALF + M;
    const t = (s: string, x: number, y: number, size = 9.5, f = r, color = INK) => page!.drawText(latin(s), { x, y, size, font: f, color });
    // header
    t(fit(store?.name ?? "", b, 13, 300), M, top - 12, 13, b);
    t("PACKING SLIP", A4.w - M - b.widthOfTextAtSize("PACKING SLIP", 11), top - 11, 11, b);
    t(`Order ${o.number}`, M, top - 32, 15, b);
    const pay = o.paymentMethod === "cod" ? `COD - collect Rs.${(o.totalPaise / 100).toFixed(2)}` : "PREPAID";
    t(pay, A4.w - M - b.widthOfTextAtSize(latin(pay), 11), top - 31, 11, b);
    t(`Placed ${ist(o.placedAt ?? o.createdAt)}  -  ${lines.reduce((n, l) => n + l.qty, 0)} item(s)`, M, top - 46, 8.5, r, GREY);
    // ship to
    const bu = o.buyer as Buyer;
    let y = top - 66;
    t("SHIP TO", M, y, 7.5, b, GREY); y -= 12;
    t(fit(`${bu.name}  -  ${bu.mobile}`, b, 10, A4.w - 2 * M), M, y, 10, b); y -= 12;
    for (const l of wrap([bu.line1, bu.line2, `${bu.city}, ${bu.state} ${bu.pincode}`].filter(Boolean).join(", "), r, 9, A4.w - 2 * M).slice(0, 3)) { t(l, M, y, 9); y -= 11; }
    // items table
    y -= 8;
    const cols = [{ k: "", w: 22 }, { k: "SKU", w: 110 }, { k: "Product", w: A4.w - 2 * M - 22 - 110 - 50 }, { k: "Qty", w: 50 }];
    page.drawRectangle({ x: M, y: y - 16, width: A4.w - 2 * M, height: 16, color: rgb(0.93, 0.95, 0.98) });
    let x = M; for (const c of cols) { t(c.k, x + 4, y - 11.5, 8, b, GREY); x += c.w; }
    y -= 16;
    for (const l of lines) {
      if (y < bottom + 40) { t("... more items on the order page", M, y - 12, 8.5, r, GREY); break; }
      const name = l.variantTitle ? `${l.title} (${l.variantTitle})` : l.title;
      const nameLines = wrap(name, r, 9, cols[2].w - 8).slice(0, 2);
      const rh = 8 + nameLines.length * 11;
      page.drawRectangle({ x: M + 6, y: y - 15, width: 10, height: 10, borderColor: INK, borderWidth: 0.9 });
      t(fit(l.sku ?? "-", r, 9, cols[1].w - 8), M + cols[0].w + 4, y - 13, 9);
      nameLines.forEach((nl, i) => t(nl, M + cols[0].w + cols[1].w + 4, y - 13 - i * 11, 9));
      t(String(l.qty), M + cols[0].w + cols[1].w + cols[2].w + 4, y - 13, 11, b);
      y -= rh;
      page.drawLine({ start: { x: M, y }, end: { x: A4.w - M, y }, thickness: 0.5, color: LINE });
    }
    t("Packed by: ____________________      Checked: [  ]", M, bottom + 6, 9, r, GREY);
    if (!big && slot === 0) page.drawLine({ start: { x: M / 2, y: HALF }, end: { x: A4.w - M / 2, y: HALF }, thickness: 0.6, color: LINE, dashArray: [4, 4] });
    slot = big ? 2 : slot + 1;
  }
  return { pdf: await doc.save(), count: orders.length };
}

/** Pick list: every SKU / option needed for the chosen orders, with total quantity and the orders that need it. */
export async function pickListPdf(orgId: string, ids: string[]) {
  const orders = (await ordersFor(orgId, ids)).filter((o) => o.status === "placed" && o.acceptance === "accepted");
  if (!orders.length) return null;
  const byKey = new Map<string, { sku: string; name: string; qty: number; orders: string[] }>();
  for (const o of orders) for (const l of o.lines as Line[]) {
    const k = `${l.productId}|${l.variantId ?? ""}`;
    const cur = byKey.get(k) ?? { sku: l.sku ?? "-", name: l.variantTitle ? `${l.title} (${l.variantTitle})` : l.title, qty: 0, orders: [] };
    cur.qty += l.qty; cur.orders.push(l.qty > 1 ? `${o.number}×${l.qty}` : o.number);
    byKey.set(k, cur);
  }
  const items = [...byKey.values()].sort((a, b) => a.sku.localeCompare(b.sku) || a.name.localeCompare(b.name));
  const doc = await PDFDocument.create();
  doc.setTitle(`Pick list (${orders.length} orders)`); doc.setCreator("vishwaship.com");
  const r = await doc.embedFont(StandardFonts.Helvetica), b = await doc.embedFont(StandardFonts.HelveticaBold);
  const cols = [{ k: "", w: 22 }, { k: "SKU", w: 100 }, { k: "Product", w: 210 }, { k: "Qty", w: 40 }, { k: "Orders", w: A4.w - 2 * M - 372 }];
  let page = doc.addPage([A4.w, A4.h]), y = A4.h - M, n = 1;
  const t = (s: string, x: number, yy: number, size = 9, f = r, color = INK) => page.drawText(latin(s), { x, y: yy, size, font: f, color });
  const head = () => {
    t("PICK LIST", M, y - 14, 15, b);
    const sub = `${orders.length} orders - ${items.reduce((s, i) => s + i.qty, 0)} units - ${ist(new Date())}`;
    t(sub, A4.w - M - r.widthOfTextAtSize(sub, 9), y - 12, 9, r, GREY);
    y -= 30;
    page.drawRectangle({ x: M, y: y - 16, width: A4.w - 2 * M, height: 16, color: rgb(0.93, 0.95, 0.98) });
    let x = M; for (const c of cols) { t(c.k, x + 4, y - 11.5, 8, b, GREY); x += c.w; }
    y -= 16;
  };
  head();
  for (const it of items) {
    const nameL = wrap(it.name, r, 9, cols[2].w - 8).slice(0, 2);
    const ordL = wrap(it.orders.join(", "), r, 8, cols[4].w - 8).slice(0, 4);
    const rh = 8 + Math.max(nameL.length, ordL.length) * 11;
    if (y - rh < M + 20) { page = doc.addPage([A4.w, A4.h]); y = A4.h - M; n++; head(); }
    page.drawRectangle({ x: M + 6, y: y - 15, width: 10, height: 10, borderColor: INK, borderWidth: 0.9 });
    let x = M + cols[0].w;
    t(fit(it.sku, r, 9, cols[1].w - 8), x + 4, y - 13); x += cols[1].w;
    nameL.forEach((l, i) => t(l, x + 4, y - 13 - i * 11)); x += cols[2].w;
    t(String(it.qty), x + 4, y - 13, 11, b); x += cols[3].w;
    ordL.forEach((l, i) => t(l, x + 4, y - 13 - i * 11, 8, r, GREY));
    y -= rh;
    page.drawLine({ start: { x: M, y }, end: { x: A4.w - M, y }, thickness: 0.5, color: LINE });
  }
  void n;
  return { pdf: await doc.save(), count: orders.length };
}

// ---------------------------------------------------------------- pack & book
export type PackResult = { id: string; number: string; ok: boolean; message: string; shipmentId: string | null; awb: string | null; carrier: string | null; booked: boolean };

/**
 * Confirm packing and make sure each order has a booked courier. Orders already booked just return their shipment
 * (their saved AWB and label are reused); others are booked with Auto-Assign. Every order reports on its own.
 */
export async function packAndBook(orgId: string, userId: string, ids: string[]): Promise<PackResult[]> {
  const db = await getDb();
  const out: PackResult[] = [];
  for (const o of await ordersFor(orgId, ids)) {
    const res = (ok: boolean, message: string, extra: Partial<PackResult> = {}): PackResult => ({ id: o.id, number: o.number, ok, message: hideProviders(message), shipmentId: null, awb: null, carrier: null, booked: false, ...extra });
    if (o.status !== "placed" || o.acceptance !== "accepted") { out.push(res(false, o.status === "cancelled" ? "Order is cancelled" : "Accept the order first")); continue; }
    const sid = await ensureShippingOrder(o.id);
    if (!sid) { out.push(res(false, "Could not prepare the shipment. Check the buyer's address and the store's pickup warehouse")); continue; }
    const packed = await db.update(schema.storeOrders).set({ packedAt: new Date(), packedBy: userId }).where(and(eq(schema.storeOrders.id, o.id), isNull(schema.storeOrders.packedAt))).returning({ id: schema.storeOrders.id });
    if (packed.length) await logOrderEvent(db, o, "packed", "Marked packed", userId);
    const live = async () => (await db.select().from(schema.shipments).where(eq(schema.shipments.orderId, sid)))
      .find((s) => !["cancelled", "failed"].includes(s.bookingStatus) && s.status !== "cancelled") ?? null;
    let ship = await live();
    if (ship) { out.push(res(true, ship.awb ? "Already booked: label reused" : "Booked; waiting for the courier's AWB", { shipmentId: ship.id, awb: ship.awb, carrier: ship.carrierName })); continue; }
    const [so] = await db.select({ status: schema.orders.status }).from(schema.orders).where(eq(schema.orders.id, sid));
    if (so?.status === "booking" || so?.status === "needs_reconcile") { out.push(res(false, "Booking is in progress with the courier. Try again in a minute")); continue; }
    const pick = await autoAssign(orgId, sid);
    if (!pick.ok) { out.push(res(false, pick.message)); continue; }
    const b = await bookOrder({ orgId, orderId: sid, quoteId: pick.offer.quoteId, actorUserId: userId });
    if (!b.ok) { out.push(res(false, b.message)); continue; }
    ship = await live();
    await logOrderEvent(db, o, "booked", `Courier booked: ${hideProviders(pick.offer.carrierName)}${b.awb ? ` (AWB ${b.awb})` : ""}`, userId);
    out.push(res(true, b.awb ? "Booked" : "Booked; waiting for the courier's AWB", { shipmentId: b.shipmentId, awb: b.awb, carrier: ship?.carrierName ?? pick.offer.carrierName, booked: true }));
  }
  return out;
}

/** Shipments of these store orders that can have labels (booked, not cancelled), in the given order. */
export async function shipmentsFor(orgId: string, ids: string[]) {
  const db = await getDb();
  const orders = (await ordersFor(orgId, ids)).filter((o) => o.shippingOrderId);
  if (!orders.length) return [];
  const ships = await db.select().from(schema.shipments).where(and(eq(schema.shipments.orgId, orgId), inArray(schema.shipments.orderId, orders.map((o) => o.shippingOrderId!))));
  return orders.map((o) => ships.find((s) => s.orderId === o.shippingOrderId && !["cancelled", "failed"].includes(s.bookingStatus) && s.status !== "cancelled")).filter((s): s is NonNullable<typeof s> => !!s).map((s) => s.id);
}
