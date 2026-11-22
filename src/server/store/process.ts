import "server-only";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { readSettings } from "@/lib/store-themes";
import { getDb, schema } from "@/server/db/client";
import { listStoreOrders, type StoreOrderView } from "./orders";
import { logOrderEvent } from "./stock";

/**
 * Process Orders: the merchant's daily dispatch desk for store orders.
 *   Non-dispatched (accepted, not yet picked up by the courier), in three steps:
 *     Print    → a courier is booked and the label printed
 *     Pack     → the parcel is packed with the label on it
 *     Handover → waiting for the courier to pick it up (leaves the list at the first pickup scan)
 *   Expired AWB  booked more than AWB_DAYS ago and still not picked up (cancel and book again)
 *   PG pending   online payment not completed yet
 *   Cancelled    rejected / cancelled orders
 * "Delayed" = not picked up within the store's dispatch time (default 48 hours from the order).
 */
export const AWB_DAYS = 7;
export type Step = "print" | "pack" | "handover";
export const STEP_LABEL: Record<Step, string> = { print: "Print", pack: "Pack", handover: "Handover" };
export type ProcessTab = "pending" | "expired" | "pg" | "cancelled";
export type ProcessFilter = { tab?: string; step?: string; kind?: string; delayed?: string; q?: string; from?: string; to?: string; courier?: string; duplicate?: string; sku?: string };

export type ProcessRow = StoreOrderView & { step: Step; delayed: boolean; dispatchBy: Date; duplicateOf: string | null; clubbed: boolean; awbAgeDays: number | null };

const ist = (d: string, end = false) => new Date(`${d}T${end ? "23:59:59" : "00:00:00"}+05:30`);
const stepOf = (o: StoreOrderView): Step => (!o.shipmentId || !o.labelPrintedAt ? "print" : !o.packedAt ? "pack" : "handover");

export async function processQueue(orgId: string, f: ProcessFilter) {
  const db = await getDb();
  const [store] = await db.select().from(schema.stores).where(eq(schema.stores.orgId, orgId));
  const hours = readSettings(store?.settings).checkout.dispatchWithinHours;
  const [toPack, ready, pg, cancelled] = await Promise.all([
    listStoreOrders(orgId, { tab: "to_pack" }), listStoreOrders(orgId, { tab: "ready" }), listStoreOrders(orgId, { tab: "unpaid" }), listStoreOrders(orgId, { tab: "cancelled" }),
  ]);
  const open = [...toPack, ...ready];
  // when each booked shipment was created (for expired AWBs)
  const shipIds = open.map((o) => o.shipmentId).filter((x): x is string => !!x);
  const ships = shipIds.length ? await db.select({ id: schema.shipments.id, at: schema.shipments.createdAt }).from(schema.shipments).where(inArray(schema.shipments.id, shipIds)) : [];
  const now = Date.now();
  // duplicates: the same buyer mobile with another live order of the same product within 2 days
  const live = [...open, ...(await listStoreOrders(orgId, { tab: "pending" }))];
  const dupOf = (o: StoreOrderView) => live.find((x) => x.id !== o.id && x.buyer.mobile === o.buyer.mobile && Math.abs(+x.createdAt - +o.createdAt) < 2 * 86_400_000
    && x.lines.some((l) => o.lines.some((m) => m.productId === l.productId && m.variantId === l.variantId)))?.number ?? null;
  const enrich = (o: StoreOrderView): ProcessRow => {
    const from = o.placedAt ?? o.createdAt;
    const dispatchBy = new Date(from.getTime() + hours * 3_600_000);
    const sAt = ships.find((s) => s.id === o.shipmentId)?.at ?? null;
    return { ...o, step: stepOf(o), delayed: now > dispatchBy.getTime(), dispatchBy, duplicateOf: dupOf(o), clubbed: o.lines.length > 1 || o.items > 1, awbAgeDays: sAt ? Math.floor((now - sAt.getTime()) / 86_400_000) : null };
  };
  const all = open.map(enrich);
  const expired = all.filter((o) => o.stage === "ready_to_ship" && (o.awbAgeDays ?? 0) >= AWB_DAYS);
  const pending = all.filter((o) => !expired.includes(o));
  const summary = {
    total: pending.length, print: pending.filter((o) => o.step === "print").length, pack: pending.filter((o) => o.step === "pack").length,
    handover: pending.filter((o) => o.step === "handover").length, delayed: pending.filter((o) => o.delayed).length,
  };
  const tab: ProcessTab = (["pending", "expired", "pg", "cancelled"] as const).find((t) => t === f.tab) ?? "pending";
  const step: Step = (["print", "pack", "handover"] as const).find((s) => s === f.step) ?? "print";
  let rows: ProcessRow[] = tab === "pending" ? pending.filter((o) => o.step === step) : tab === "expired" ? expired : (tab === "pg" ? pg : cancelled).map(enrich);
  const stepCounts = { single: 0, clubbed: 0, delayed: 0 };
  if (tab === "pending") { stepCounts.single = rows.filter((o) => !o.clubbed).length; stepCounts.clubbed = rows.filter((o) => o.clubbed).length; stepCounts.delayed = rows.filter((o) => o.delayed).length; }
  if (f.kind === "single") rows = rows.filter((o) => !o.clubbed);
  if (f.kind === "clubbed") rows = rows.filter((o) => o.clubbed);
  if (f.delayed === "1") rows = rows.filter((o) => o.delayed);
  if (f.duplicate === "yes") rows = rows.filter((o) => o.duplicateOf);
  if (f.duplicate === "no") rows = rows.filter((o) => !o.duplicateOf);
  if (f.courier) rows = rows.filter((o) => o.carrierName === f.courier);
  if (f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from)) rows = rows.filter((o) => (o.placedAt ?? o.createdAt) >= ist(f.from!));
  if (f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to)) rows = rows.filter((o) => (o.placedAt ?? o.createdAt) <= ist(f.to!, true));
  const q = f.q?.trim().toUpperCase();
  if (q) rows = rows.filter((o) => o.number.toUpperCase().includes(q) || (o.awb ?? "").toUpperCase().includes(q) || o.buyer.mobile.includes(q) || o.lines.some((l) => (l.sku ?? "").toUpperCase().includes(q)));
  if (f.sku) rows = rows.filter((o) => o.lines.some((l) => (l.sku ?? l.title) === f.sku));
  rows.sort((a, b) => +a.dispatchBy - +b.dispatchBy);
  // Group by SKU: how many pieces of each SKU the rows in view need
  const skus = new Map<string, { sku: string; title: string; qty: number; orders: number }>();
  for (const o of rows) for (const l of o.lines) {
    const k = l.sku ?? l.title;
    const cur = skus.get(k) ?? { sku: k, title: l.variantTitle ? `${l.title} (${l.variantTitle})` : l.title, qty: 0, orders: 0 };
    cur.qty += l.qty; cur.orders++; skus.set(k, cur);
  }
  const couriers = [...new Set(all.map((o) => o.carrierName).filter((c): c is string => !!c))].sort();
  return { tab, step, rows, summary, counts: { pending: pending.length, expired: expired.length, pg: pg.length, cancelled: cancelled.length }, stepCounts, skus: [...skus.values()].sort((a, b) => b.qty - a.qty), couriers, dispatchHours: hours };
}

/** Pack step: mark parcels packed (only those whose label is printed). */
export async function markPacked(orgId: string, userId: string, ids: string[]) {
  const db = await getDb();
  const want = [...new Set(ids)].slice(0, 200);
  // a parcel is packed only after its label exists
  const ok = await db.update(schema.storeOrders).set({ packedAt: new Date(), packedBy: userId })
    .where(and(eq(schema.storeOrders.orgId, orgId), inArray(schema.storeOrders.id, want), isNull(schema.storeOrders.packedAt), isNotNull(schema.storeOrders.labelPrintedAt), eq(schema.storeOrders.status, "placed")))
    .returning();
  for (const o of ok) await logOrderEvent(db, o, "packed", "Marked packed", userId);
  const early = want.length > ok.length ? await db.select({ number: schema.storeOrders.number }).from(schema.storeOrders)
    .where(and(eq(schema.storeOrders.orgId, orgId), inArray(schema.storeOrders.id, want), isNull(schema.storeOrders.labelPrintedAt))) : [];
  return { packed: ok.map((o) => o.number), skipped: early.map((o) => o.number) };
}

/** Handover step: the merchant handed these parcels to the courier (they leave the list at the courier's pickup scan). */
export async function markHandedOver(orgId: string, userId: string, ids: string[]) {
  const db = await getDb();
  const rows = await db.update(schema.storeOrders).set({ handedOverAt: new Date() })
    .where(and(eq(schema.storeOrders.orgId, orgId), inArray(schema.storeOrders.id, [...new Set(ids)].slice(0, 200)), isNull(schema.storeOrders.handedOverAt), eq(schema.storeOrders.status, "placed")))
    .returning();
  for (const o of rows) await logOrderEvent(db, o, "handed_over", "Handed over to the courier", userId);
  return { handedOver: rows.map((o) => o.number) };
}

/** Print step: labels were made for these orders (they move on to Pack). */
export async function markLabelsPrinted(orgId: string, ids: string[]) {
  const db = await getDb();
  if (!ids.length) return;
  await db.update(schema.storeOrders).set({ labelPrintedAt: new Date() })
    .where(and(eq(schema.storeOrders.orgId, orgId), inArray(schema.storeOrders.id, ids), isNull(schema.storeOrders.labelPrintedAt)));
}
