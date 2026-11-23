import "server-only";
import { type CostExtras, EXTRA_FIELDS, readExtras } from "@/lib/store-costs";
import { and, asc, desc, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/server/db/client";
import { StoreError } from "./catalog";
import type { Line } from "./checkout";
import { logOrderEvent, move, type Tx } from "./stock";

/**
 * Inventory per sellable item (a product without options, or each option of a product). Counts:
 *   available = can be sold now (`stock`), reserved = held for orders not yet shipped, damaged = set aside,
 *   on hand = available + reserved (what should be on the shelf).
 * Every change goes through one conditional update plus a store_stock_moves row, so the history adds up.
 * Unit cost is a moving average updated on receipts; costs already captured on shipped orders never change.
 */
type P = typeof schema.storeProducts.$inferSelect;
type V = typeof schema.storeProductVariants.$inferSelect;
export type InvRow = {
  key: string; productId: string; variantId: string | null; title: string; variantTitle: string | null; sku: string | null; image: string | null;
  available: number; reserved: number; damaged: number; onHand: number; reorderAt: number; unitCostPaise: number | null; low: boolean; status: string;
};
export const INV_VIEWS = [
  { key: "all", label: "All items" }, { key: "low", label: "Low stock" }, { key: "out", label: "Out of stock" },
  { key: "damaged", label: "Damaged" }, { key: "nocost", label: "Cost missing" },
] as const;

async function storeOf(orgId: string) {
  const db = await getDb();
  const [s] = await db.select({ id: schema.stores.id }).from(schema.stores).where(eq(schema.stores.orgId, orgId));
  if (!s) throw new StoreError("Create your store first");
  return s.id;
}

function rowsOf(p: P, vs: V[]): InvRow[] {
  const img = (p.images as string[])[0] ?? null;
  const base = { productId: p.id, title: p.title, image: img, reorderAt: p.lowStockAt, status: p.status };
  const mine = vs.filter((v) => v.productId === p.id && !v.archived);
  if ((p.options as string[]).length && mine.length) return mine.map((v) => ({
    ...base, key: `${p.id}|${v.id}`, variantId: v.id, variantTitle: v.title, sku: v.sku ?? p.sku, available: v.stock, reserved: v.reserved, damaged: v.damaged,
    onHand: v.stock + v.reserved, unitCostPaise: v.unitCostPaise ?? p.unitCostPaise, low: v.stock <= p.lowStockAt,
  }));
  return [{ ...base, key: `${p.id}|`, variantId: null, variantTitle: null, sku: p.sku, available: p.stock, reserved: p.reserved, damaged: p.damaged, onHand: p.stock + p.reserved, unitCostPaise: p.unitCostPaise, low: p.stock <= p.lowStockAt }];
}

/** Every sellable item of the store (archived products left out). */
export async function inventoryList(orgId: string, f: { view?: string; q?: string } = {}) {
  const storeId = await storeOf(orgId);
  const db = await getDb();
  const prods = await db.select().from(schema.storeProducts).where(and(eq(schema.storeProducts.storeId, storeId), ne(schema.storeProducts.status, "archived"))).orderBy(asc(schema.storeProducts.title));
  const vs = prods.length ? await db.select().from(schema.storeProductVariants).where(eq(schema.storeProductVariants.storeId, storeId)).orderBy(asc(schema.storeProductVariants.sort)) : [];
  const all = prods.flatMap((p) => rowsOf(p, vs));
  const counts = { all: all.length, low: all.filter((r) => r.low && r.available > 0).length, out: all.filter((r) => r.available <= 0).length, damaged: all.filter((r) => r.damaged > 0).length, nocost: all.filter((r) => r.unitCostPaise === null).length };
  let rows = all;
  const view = INV_VIEWS.find((v) => v.key === f.view)?.key ?? "all";
  if (view === "low") rows = rows.filter((r) => r.low && r.available > 0);
  if (view === "out") rows = rows.filter((r) => r.available <= 0);
  if (view === "damaged") rows = rows.filter((r) => r.damaged > 0);
  if (view === "nocost") rows = rows.filter((r) => r.unitCostPaise === null);
  const q = f.q?.trim().toLowerCase();
  if (q) rows = rows.filter((r) => `${r.sku ?? ""} ${r.title} ${r.variantTitle ?? ""}`.toLowerCase().includes(q));
  return { rows, counts, view, totals: { units: all.reduce((s, r) => s + r.onHand, 0), valuePaise: all.reduce((s, r) => s + (r.unitCostPaise ?? 0) * r.onHand, 0) } };
}

/** Items at or below their reorder level (for the sidebar badge / overview). */
export async function lowStockCount(orgId: string) {
  const db = await getDb();
  const P = schema.storeProducts, V = schema.storeProductVariants;
  // two cheap counts (runs on every portal page for the sidebar badge)
  const [{ a }] = await db.select({ a: sql<number>`count(*)::int` }).from(P)
    .where(and(eq(P.orgId, orgId), ne(P.status, "archived"), sql`jsonb_array_length(${P.options}) = 0`, sql`${P.stock} > 0`, sql`${P.stock} <= ${P.lowStockAt}`));
  const [{ b }] = await db.select({ b: sql<number>`count(*)::int` }).from(V).innerJoin(P, eq(P.id, V.productId))
    .where(and(eq(V.orgId, orgId), eq(V.archived, false), ne(P.status, "archived"), sql`jsonb_array_length(${P.options}) > 0`, sql`${V.stock} > 0`, sql`${V.stock} <= ${P.lowStockAt}`));
  return a + b;
}

// ---------------------------------------------------------------- changes
export const AdjustInput = z.object({
  productId: z.string().max(60), variantId: z.string().max(60).nullable().default(null),
  kind: z.enum(["receipt", "count", "damage", "write_off", "repair"]),
  qty: z.number().int().min(0).max(1_000_000),
  unitCostPaise: z.number().int().min(0).max(100_000_000).nullable().default(null),
  reason: z.string().trim().max(200).default(""),
});
export type AdjustInput = z.infer<typeof AdjustInput>;

/** Apply one change to the counts of an item (and its product's totals when it is an option). Returns the delta. */
async function applyDelta(tx: Tx, it: { p: P; v: V | null }, d: { available: number; damaged: number }) {
  const Pt = schema.storeProducts, Vt = schema.storeProductVariants;
  if (it.v) {
    const ok = await tx.update(Vt).set({ stock: sql`${Vt.stock} + ${d.available}`, damaged: sql`${Vt.damaged} + ${d.damaged}` })
      .where(and(eq(Vt.id, it.v.id), gte(Vt.stock, -d.available), gte(Vt.damaged, -d.damaged))).returning({ id: Vt.id });
    if (!ok.length) return false;
    await tx.update(Pt).set({ stock: sql`greatest(${Pt.stock} + ${d.available}, 0)`, damaged: sql`greatest(${Pt.damaged} + ${d.damaged}, 0)`, updatedAt: new Date() }).where(eq(Pt.id, it.p.id));
    return true;
  }
  const ok = await tx.update(Pt).set({ stock: sql`${Pt.stock} + ${d.available}`, damaged: sql`${Pt.damaged} + ${d.damaged}`, updatedAt: new Date() })
    .where(and(eq(Pt.id, it.p.id), gte(Pt.stock, -d.available), gte(Pt.damaged, -d.damaged))).returning({ id: Pt.id });
  return ok.length > 0;
}

async function item(orgId: string, productId: string, variantId: string | null, q?: Tx) {
  const db = q ?? (await getDb());
  const [p] = await db.select().from(schema.storeProducts).where(and(eq(schema.storeProducts.id, productId), eq(schema.storeProducts.orgId, orgId)));
  if (!p) throw new StoreError("Item not found");
  const hasOptions = (p.options as string[]).length > 0;
  if (hasOptions && !variantId) throw new StoreError("Choose the option (size / colour) to change");
  let v: V | null = null;
  if (variantId) {
    [v] = await db.select().from(schema.storeProductVariants).where(and(eq(schema.storeProductVariants.id, variantId), eq(schema.storeProductVariants.productId, p.id)));
    if (!v) throw new StoreError("Item not found");
  }
  return { p, v };
}

/**
 * Receive stock (purchase), set the counted quantity, move units to damaged, write damaged units off, or put
 * repaired units back on sale. Never lets a count go below zero; two changes at once both land.
 */
export async function adjustStock(orgId: string, actorUserId: string, input: AdjustInput) {
  const a = AdjustInput.parse(input);
  const db = await getDb();
  if (a.kind !== "count" && a.qty <= 0) throw new StoreError("Enter a quantity");
  if (["count", "damage", "write_off"].includes(a.kind) && a.reason.length < 3) throw new StoreError("Give a reason");
  return db.transaction(async (tx) => {
    const it = await item(orgId, a.productId, a.variantId, tx);
    const cur = it.v ? { available: it.v.stock, damaged: it.v.damaged, reserved: it.v.reserved, cost: it.v.unitCostPaise ?? it.p.unitCostPaise } : { available: it.p.stock, damaged: it.p.damaged, reserved: it.p.reserved, cost: it.p.unitCostPaise };
    let d = { available: 0, damaged: 0 };
    if (a.kind === "receipt") d = { available: a.qty, damaged: 0 };
    if (a.kind === "count") d = { available: a.qty - cur.available, damaged: 0 };
    if (a.kind === "damage") { if (a.qty > cur.available) throw new StoreError(`Only ${cur.available} available to mark damaged`); d = { available: -a.qty, damaged: a.qty }; }
    if (a.kind === "write_off") { if (a.qty > cur.damaged) throw new StoreError(`Only ${cur.damaged} damaged to write off`); d = { available: 0, damaged: -a.qty }; }
    if (a.kind === "repair") { if (a.qty > cur.damaged) throw new StoreError(`Only ${cur.damaged} damaged to put back`); d = { available: a.qty, damaged: -a.qty }; }
    if (d.available === 0 && d.damaged === 0 && a.kind === "count") return { ok: true as const, delta: d };
    if (!(await applyDelta(tx, it, d))) throw new StoreError("The stock changed meanwhile. Refresh and try again.");
    // receipt with a price: moving average over what is on hand, from now on only
    let cost: number | null = null;
    if (a.kind === "receipt" && a.unitCostPaise !== null) {
      const onHand = Math.max(0, cur.available + cur.reserved);
      cost = cur.cost === null || onHand === 0 ? a.unitCostPaise : Math.round((cur.cost * onHand + a.unitCostPaise * a.qty) / (onHand + a.qty));
      if (it.v) await tx.update(schema.storeProductVariants).set({ unitCostPaise: cost }).where(eq(schema.storeProductVariants.id, it.v.id));
      else await tx.update(schema.storeProducts).set({ unitCostPaise: cost }).where(eq(schema.storeProducts.id, it.p.id));
    }
    const kind = { receipt: "receipt", count: "adjust", damage: "damage", write_off: "write_off", repair: "repair" }[a.kind];
    await move(tx, { storeId: it.p.storeId, orgId }, { productId: it.p.id, variantId: it.v?.id ?? null }, kind, d,
      { unitCostPaise: a.kind === "receipt" ? a.unitCostPaise : null, reason: a.reason || null, actorUserId });
    return { ok: true as const, delta: d, unitCostPaise: cost };
  });
}

/** Unit cost (forward only) and reorder level of an item. */
export async function updateItem(orgId: string, input: { productId: string; variantId: string | null; unitCostPaise?: number | null; reorderAt?: number }) {
  const it = await item(orgId, input.productId, input.variantId);
  const db = await getDb();
  if (input.unitCostPaise !== undefined) {
    if (it.v) await db.update(schema.storeProductVariants).set({ unitCostPaise: input.unitCostPaise }).where(eq(schema.storeProductVariants.id, it.v.id));
    else await db.update(schema.storeProducts).set({ unitCostPaise: input.unitCostPaise, updatedAt: new Date() }).where(eq(schema.storeProducts.id, it.p.id));
  }
  if (input.reorderAt !== undefined) await db.update(schema.storeProducts).set({ lowStockAt: input.reorderAt, updatedAt: new Date() }).where(eq(schema.storeProducts.id, it.p.id));
}

export const MOVE_LABEL: Record<string, string> = {
  order_reserved: "Held for an order", order_released: "Order cancelled: back on sale", order_dispatched: "Shipped", receipt: "Received",
  adjust: "Counted / corrected", damage: "Marked damaged", write_off: "Damaged written off", repair: "Repaired: back on sale",
  return_sellable: "Returned: back on sale", return_damaged: "Returned damaged", return_missing: "Returned: missing", edit: "Changed in the product editor", opening: "Opening stock",
};

export async function stockHistory(orgId: string, productId: string, variantId: string | null, limit = 100) {
  const db = await getDb();
  const M = schema.storeStockMoves;
  return db.select({ kind: M.kind, available: M.available, reserved: M.reserved, damaged: M.damaged, reason: M.reason, unitCostPaise: M.unitCostPaise, at: M.createdAt, actor: schema.users.name, order: schema.storeOrders.number, orderId: schema.storeOrders.id })
    .from(M).leftJoin(schema.users, eq(schema.users.id, M.actorUserId)).leftJoin(schema.storeOrders, eq(schema.storeOrders.id, M.storeOrderId))
    .where(and(eq(M.orgId, orgId), eq(M.productId, productId), variantId ? eq(M.variantId, variantId) : isNull(M.variantId))).orderBy(desc(M.createdAt)).limit(limit);
}

// ---------------------------------------------------------------- returns (RTO / customer)
/** Orders whose goods came back and have not been counted yet. */
export async function returnsToInspect(orgId: string, customerReturnOf?: string) {
  const db = await getDb();
  const statuses = ["rto_delivered", "reverse_delivered"];
  const base = and(eq(schema.storeOrders.orgId, orgId), eq(schema.storeOrders.stockState, "deducted"), isNull(schema.storeOrders.returnInspectedAt));
  const rows = await db.select({ o: schema.storeOrders, st: schema.shipments.status }).from(schema.storeOrders)
    .innerJoin(schema.shipments, eq(schema.shipments.orderId, schema.storeOrders.shippingOrderId))
    .where(and(base, customerReturnOf ? sql`(${inArray(schema.shipments.status, statuses)} or ${schema.storeOrders.id} = ${customerReturnOf})` : inArray(schema.shipments.status, statuses)))
    .orderBy(desc(schema.storeOrders.createdAt)).limit(200);
  const seen = new Set<string>();
  return rows.filter((r) => !seen.has(r.o.id) && seen.add(r.o.id))
    .map((r) => ({ id: r.o.id, number: r.o.number, kind: r.st === "rto_delivered" ? "RTO" : "Customer return", buyer: (r.o.buyer as { name: string }).name, lines: (r.o.lines as Line[]).map((l) => ({ title: l.title, variantTitle: l.variantTitle, sku: l.sku, qty: l.qty })) }));
}

export const InspectInput = z.object({ lines: z.array(z.object({ sellable: z.number().int().min(0), damaged: z.number().int().min(0), missing: z.number().int().min(0) })).min(1).max(30), note: z.string().trim().max(200).default("") });

/**
 * Count what came back for one order, once: sellable units go back on sale (at the cost they left with), damaged
 * units are set aside, missing units are only recorded. Allowed for RTO / returned shipments, or a customer return
 * the merchant records by hand on a delivered order.
 */
export async function inspectReturn(orgId: string, actorUserId: string, storeOrderId: string, input: z.infer<typeof InspectInput>) {
  const a = InspectInput.parse(input);
  const db = await getDb();
  const [o] = await db.select().from(schema.storeOrders).where(and(eq(schema.storeOrders.id, storeOrderId), eq(schema.storeOrders.orgId, orgId)));
  if (!o) throw new StoreError("Order not found");
  if (o.returnInspectedAt) throw new StoreError("This return was already counted");
  if (o.stockState !== "deducted") throw new StoreError("Only shipped orders can have a return");
  const lines = o.lines as Line[];
  if (a.lines.length !== lines.length) throw new StoreError("Count every item of the order");
  a.lines.forEach((l, i) => { if (l.sellable + l.damaged + l.missing !== lines[i].qty) throw new StoreError(`${lines[i].title}: sellable + damaged + missing must be ${lines[i].qty}`); });
  const costs = (o.costs as Array<{ productId: string; variantId: string | null; unitCostPaise: number | null }> | null) ?? [];
  return db.transaction(async (tx) => {
    const won = await tx.update(schema.storeOrders).set({ returnInspectedAt: new Date(), returnInspection: { lines: a.lines, note: a.note || null, by: actorUserId } })
      .where(and(eq(schema.storeOrders.id, o.id), isNull(schema.storeOrders.returnInspectedAt))).returning({ id: schema.storeOrders.id });
    if (!won.length) throw new StoreError("This return was already counted");
    for (const [i, l] of lines.entries()) {
      const c = a.lines[i];
      const [p] = await tx.select().from(schema.storeProducts).where(eq(schema.storeProducts.id, l.productId));
      if (!p) continue;
      const [v] = l.variantId ? await tx.select().from(schema.storeProductVariants).where(eq(schema.storeProductVariants.id, l.variantId)) : [null];
      if (c.sellable || c.damaged) await applyDelta(tx, { p, v: v ?? null }, { available: c.sellable, damaged: c.damaged });
      const cost = costs.find((x) => x.productId === l.productId && x.variantId === l.variantId)?.unitCostPaise ?? null;
      const it = { productId: l.productId, variantId: l.variantId };
      if (c.sellable) await move(tx, o, it, "return_sellable", { available: c.sellable }, { unitCostPaise: cost, reason: a.note || null, actorUserId });
      if (c.damaged) await move(tx, o, it, "return_damaged", { damaged: c.damaged }, { unitCostPaise: cost, reason: a.note || null, actorUserId });
      if (c.missing) await move(tx, o, it, "return_missing", {}, { unitCostPaise: cost, reason: a.note || null, actorUserId });
    }
    const t = a.lines.reduce((s, l) => ({ s: s.s + l.sellable, d: s.d + l.damaged, m: s.m + l.missing }), { s: 0, d: 0, m: 0 });
    await logOrderEvent(tx, o, "return_counted", `Return counted: ${t.s} back on sale, ${t.d} damaged, ${t.m} missing${a.note ? ` (${a.note})` : ""}`, actorUserId);
    return { ok: true as const, ...t };
  });
}

// ---------------------------------------------------------------- CSV
const csvCell = (v: unknown) => { const s = String(v ?? ""); return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"` : s; };
export const INV_HEADERS = ["sku", "product", "option", "available", "reserved", "damaged", "on_hand", "reorder_level", "unit_cost", "packaging_cost", "labour_cost", "other_cost", "overhead_cost"] as const;

export async function exportInventoryCsv(orgId: string) {
  const { rows } = await inventoryList(orgId);
  const db = await getDb();
  const ex = rows.length ? await db.select({ id: schema.storeProducts.id, x: schema.storeProducts.costExtras }).from(schema.storeProducts).where(inArray(schema.storeProducts.id, [...new Set(rows.map((r) => r.productId))])) : [];
  const out = [INV_HEADERS.join(",")];
  for (const r of rows) {
    const x = readExtras(ex.find((e) => e.id === r.productId)?.x);
    out.push([r.sku ?? "", r.title, r.variantTitle ?? "", r.available, r.reserved, r.damaged, r.onHand, r.reorderAt, r.unitCostPaise === null ? "" : (r.unitCostPaise / 100).toFixed(2),
      ...EXTRA_FIELDS.map((f) => (x[f.key] / 100).toFixed(2))].map(csvCell).join(","));
  }
  return out.join("\r\n");
}

type Plan = { row: number; sku: string; key: string | null; title: string; set: { available?: number; unitCostPaise?: number; reorderAt?: number; extras?: Partial<CostExtras> }; errors: string[] };

/**
 * Inventory CSV: match rows by SKU, then (optionally) set the available count, unit cost and reorder level. The
 * preview lists each row's problems; applying skips bad rows and records counted changes with reason "CSV import".
 */
export async function planInventoryImport(orgId: string, text: string) {
  const { parseCsv } = await import("@/server/orders/bulk");
  const grid = parseCsv(text.replace(/^﻿/, "")).filter((r) => r.some((c) => c.trim()));
  if (!grid.length) throw new StoreError("The file is empty");
  const head = grid[0].map((h) => h.trim().toLowerCase());
  const col = (r: string[], k: string) => { const i = head.indexOf(k); return i >= 0 ? (r[i] ?? "").trim() : ""; };
  if (!head.includes("sku")) throw new StoreError("The first row must have a 'sku' column");
  if (grid.length > 5001) throw new StoreError("Up to 5,000 rows at a time");
  const { rows } = await inventoryList(orgId);
  const bySku = new Map<string, InvRow[]>();
  for (const r of rows) if (r.sku) bySku.set(r.sku.toLowerCase(), [...(bySku.get(r.sku.toLowerCase()) ?? []), r]);
  const seen = new Set<string>();
  const plans: Plan[] = grid.slice(1).map((r, i) => {
    const sku = col(r, "sku"), errors: string[] = [], set: Plan["set"] = {};
    const hits = bySku.get(sku.toLowerCase()) ?? [];
    if (!sku) errors.push("SKU is empty");
    else if (!hits.length) errors.push("No item with this SKU");
    else if (hits.length > 1) errors.push(`SKU used by ${hits.length} items: give each a unique SKU`);
    else if (seen.has(hits[0].key)) errors.push("Same SKU twice in the file");
    if (hits.length === 1) seen.add(hits[0].key);
    const int = (k: string, label: string, max: number) => { const v = col(r, k); if (!v) return undefined; if (!/^\d+$/.test(v) || Number(v) > max) { errors.push(`${label} must be a whole number`); return undefined; } return Number(v); };
    set.available = int("available", "available", 1_000_000);
    set.reorderAt = int("reorder_level", "reorder_level", 100_000);
    const c = col(r, "unit_cost").replace(/[₹,\s]/g, "");
    if (c) { if (!/^\d+(\.\d{1,2})?$/.test(c)) errors.push("unit_cost must be a price like 125.50"); else set.unitCostPaise = Math.round(Number(c) * 100); }
    for (const f of EXTRA_FIELDS) {
      const v = col(r, f.csv).replace(/[₹,\s]/g, "");
      if (!v) continue;
      if (!/^\d+(\.\d{1,2})?$/.test(v) || Number(v) > 100_000) errors.push(`${f.csv} must be a price like 12.50`);
      else set.extras = { ...(set.extras ?? {}), [f.key]: Math.round(Number(v) * 100) };
    }
    if (set.available === undefined && set.reorderAt === undefined && set.unitCostPaise === undefined && !set.extras && !errors.length) errors.push("Nothing to change (fill available, unit_cost, reorder_level or a per-piece cost)");
    return { row: i + 2, sku, key: hits.length === 1 ? hits[0].key : null, title: hits[0] ? `${hits[0].title}${hits[0].variantTitle ? ` (${hits[0].variantTitle})` : ""}` : "", set, errors };
  });
  return { rows: plans, valid: plans.filter((p) => !p.errors.length).length, invalid: plans.filter((p) => p.errors.length).length };
}

/** Per-piece costs for one or many products (fields left out keep their value). Other orgs' products are ignored. */
export async function setCostExtras(orgId: string, productIds: string[], patch: Partial<CostExtras>) {
  const db = await getDb();
  const rows = await db.select({ id: schema.storeProducts.id, x: schema.storeProducts.costExtras }).from(schema.storeProducts)
    .where(and(eq(schema.storeProducts.orgId, orgId), inArray(schema.storeProducts.id, [...new Set(productIds)].slice(0, 5000))));
  for (const r of rows) await db.update(schema.storeProducts).set({ costExtras: { ...readExtras(r.x), ...patch }, updatedAt: new Date() }).where(eq(schema.storeProducts.id, r.id));
  return rows.length;
}

export async function runInventoryImport(orgId: string, actorUserId: string, text: string) {
  const plan = await planInventoryImport(orgId, text);
  let changed = 0;
  for (const p of plan.rows) {
    if (p.errors.length || !p.key) continue;
    const [productId, v] = p.key.split("|");
    const variantId = v || null;
    if (p.set.available !== undefined) await adjustStock(orgId, actorUserId, { productId, variantId, kind: "count", qty: p.set.available, unitCostPaise: null, reason: "CSV import" });
    if (p.set.unitCostPaise !== undefined || p.set.reorderAt !== undefined) await updateItem(orgId, { productId, variantId, unitCostPaise: p.set.unitCostPaise, reorderAt: p.set.reorderAt });
    if (p.set.extras) await setCostExtras(orgId, [productId], p.set.extras);
    changed++;
  }
  return { changed, skipped: plan.invalid };
}
