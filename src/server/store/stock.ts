import "server-only";
import { extrasTotal } from "@/lib/store-costs";
import { and, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { newId } from "@/server/util/ids";

/**
 * Store stock. `stock` on a product/variant is what can still be sold; `reserved` is held for orders that have not
 * left the warehouse; `damaged` is set aside. A product with variants keeps its own counts as the sum of its variants.
 *   checkout      → stock −q, reserved +q   (order_reserved; a conditional update, so two buyers can't take the last unit)
 *   reject/cancel → stock +q, reserved −q   (order_released, exactly once per order)
 *   goods shipped → reserved −q             (order_dispatched, exactly once; unit cost captured for profit)
 * Every change is written to store_stock_moves.
 */
type Db = Awaited<ReturnType<typeof getDb>>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Q = Db | Tx;
type Line = { productId: string; variantId: string | null; qty: number; title: string };
type O = typeof schema.storeOrders.$inferSelect;

export async function logOrderEvent(q: Q, o: { id: string; orgId: string }, kind: string, message: string, actorUserId: string | null = null) {
  await q.insert(schema.storeOrderEvents).values({ id: newId("soe"), storeOrderId: o.id, orgId: o.orgId, kind, message: message.slice(0, 500), actorUserId });
}

export async function move(q: Q, o: { storeId: string; orgId: string; id?: string }, l: Pick<Line, "productId" | "variantId">, kind: string, d: { available?: number; reserved?: number; damaged?: number }, extra: { unitCostPaise?: number | null; reason?: string | null; actorUserId?: string | null } = {}) {
  await q.insert(schema.storeStockMoves).values({
    id: newId("smv"), storeId: o.storeId, orgId: o.orgId, productId: l.productId, variantId: l.variantId, kind,
    available: d.available ?? 0, reserved: d.reserved ?? 0, damaged: d.damaged ?? 0, unitCostPaise: extra.unitCostPaise ?? null,
    storeOrderId: o.id ?? null, reason: extra.reason ?? null, actorUserId: extra.actorUserId ?? null,
  });
}

/** Hold stock for a new order line. Returns false when not enough is left (the caller aborts the checkout). */
export async function reserveLine(tx: Tx, o: { id: string; storeId: string; orgId: string }, l: Line) {
  const P = schema.storeProducts, V = schema.storeProductVariants;
  const res = l.variantId
    ? await tx.update(V).set({ stock: sql`${V.stock} - ${l.qty}`, reserved: sql`${V.reserved} + ${l.qty}` }).where(and(eq(V.id, l.variantId), gte(V.stock, l.qty))).returning({ id: V.id })
    : await tx.update(P).set({ stock: sql`${P.stock} - ${l.qty}`, reserved: sql`${P.reserved} + ${l.qty}` }).where(and(eq(P.id, l.productId), gte(P.stock, l.qty))).returning({ id: P.id });
  if (!res.length) return false;
  // keep the product's totals (shown in lists) in step with its variants
  if (l.variantId) await tx.update(P).set({ stock: sql`greatest(${P.stock} - ${l.qty}, 0)`, reserved: sql`${P.reserved} + ${l.qty}` }).where(eq(P.id, l.productId));
  await move(tx, o, l, "order_reserved", { available: -l.qty, reserved: l.qty });
  return true;
}

/** Give an order's stock (and its coupon use) back exactly once. Goods that already left are never "given back". */
export async function releaseOrderStock(tx: Tx, o: O) {
  const held = o.stockState === "reserved";
  const claimed = await tx.update(schema.storeOrders).set({ stockReleased: true, stockState: held ? "released" : o.stockState })
    .where(and(eq(schema.storeOrders.id, o.id), eq(schema.storeOrders.stockReleased, false), ne(schema.storeOrders.stockState, "deducted"))).returning({ id: schema.storeOrders.id });
  if (!claimed.length) return false;
  const P = schema.storeProducts, V = schema.storeProductVariants;
  const r = held ? 1 : 0;
  for (const l of o.lines as Line[]) {
    if (l.variantId) await tx.update(V).set({ stock: sql`${V.stock} + ${l.qty}`, reserved: sql`greatest(${V.reserved} - ${l.qty * r}, 0)` }).where(eq(V.id, l.variantId));
    await tx.update(P).set({ stock: sql`${P.stock} + ${l.qty}`, reserved: sql`greatest(${P.reserved} - ${l.qty * r}, 0)` }).where(eq(P.id, l.productId));
    await move(tx, o, l, "order_released", { available: l.qty, reserved: -l.qty * r });
  }
  if (o.couponCode) await tx.update(schema.storeCoupons).set({ used: sql`greatest(${schema.storeCoupons.used} - 1, 0)` }).where(and(eq(schema.storeCoupons.storeId, o.storeId), eq(schema.storeCoupons.code, o.couponCode)));
  return true;
}

/** The goods left the warehouse: stop holding them and record what they cost. Exactly once per order. */
export async function deductOrderStock(storeOrderId: string) {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [o] = await tx.update(schema.storeOrders).set({ stockState: "deducted" })
      .where(and(eq(schema.storeOrders.id, storeOrderId), eq(schema.storeOrders.stockState, "reserved"), eq(schema.storeOrders.stockReleased, false))).returning();
    if (!o) return false;
    const lines = o.lines as Line[];
    const P = schema.storeProducts, V = schema.storeProductVariants;
    const prods = await tx.select({ id: P.id, cost: P.unitCostPaise, extras: P.costExtras }).from(P).where(inArray(P.id, lines.map((l) => l.productId)));
    const vids = lines.map((l) => l.variantId).filter((v): v is string => !!v);
    const vars = vids.length ? await tx.select({ id: V.id, cost: V.unitCostPaise }).from(V).where(inArray(V.id, vids)) : [];
    const costs = [];
    for (const l of lines) {
      const cost = (l.variantId ? vars.find((v) => v.id === l.variantId)?.cost : null) ?? prods.find((p) => p.id === l.productId)?.cost ?? null;
      if (l.variantId) await tx.update(V).set({ reserved: sql`greatest(${V.reserved} - ${l.qty}, 0)` }).where(eq(V.id, l.variantId));
      await tx.update(P).set({ reserved: sql`greatest(${P.reserved} - ${l.qty}, 0)` }).where(eq(P.id, l.productId));
      await move(tx, o, l, "order_dispatched", { reserved: -l.qty }, { unitCostPaise: cost });
      costs.push({ productId: l.productId, variantId: l.variantId, qty: l.qty, unitCostPaise: cost, extrasPaise: extrasTotal(prods.find((p) => p.id === l.productId)?.extras) });
    }
    await tx.update(schema.storeOrders).set({ costs }).where(eq(schema.storeOrders.id, o.id));
    await logOrderEvent(tx, o, "dispatched", "Goods left the warehouse: stock deducted");
    return true;
  });
}

/** Background: orders whose shipment has been picked up (or moved further) get their held stock deducted. */
export async function sweepDispatched() {
  const db = await getDb();
  const rows = await db.select({ id: schema.storeOrders.id }).from(schema.storeOrders)
    .innerJoin(schema.shipments, eq(schema.shipments.orderId, schema.storeOrders.shippingOrderId))
    .where(and(eq(schema.storeOrders.stockState, "reserved"), eq(schema.storeOrders.status, "placed"), eq(schema.storeOrders.stockReleased, false),
      inArray(schema.shipments.bookingStatus, ["confirmed", "pending", "ambiguous"]),
      sql`${schema.shipments.status} not in ('booked', 'pickup_pending', 'cancelled')`)).limit(100);
  let n = 0;
  for (const r of rows) if (await deductOrderStock(r.id)) n++;
  return n;
}
