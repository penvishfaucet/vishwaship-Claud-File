import "server-only";
import { and, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { STATUS_GROUPS } from "@/lib/status";
import { bucketCondition, dashRange, isBucket, rangeCondition } from "@/server/portal/buckets";

/** All functions take orgId from portalContext(); never from user input. */

export async function statusCounts(orgId: string) {
  const db = await getDb();
  const rows = await db.select({ status: schema.shipments.status, n: count() }).from(schema.shipments)
    .where(eq(schema.shipments.orgId, orgId)).groupBy(schema.shipments.status);
  const by = Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
  return STATUS_GROUPS.map((g) => ({ ...g, count: g.statuses.reduce((s, st) => s + (by[st] ?? 0), 0) }));
}

export async function listOrders(orgId: string, opts: { q?: string; group?: string; payment?: string; mode?: string; tag?: string; bucket?: string; from?: string; to?: string; page?: number; pageSize?: number }) {
  const db = await getDb();
  const pageSize = opts.pageSize ?? 20;
  const page = Math.max(1, opts.page ?? 1);
  const conds = [eq(schema.orders.orgId, orgId)];
  const grp = STATUS_GROUPS.find((g) => g.key === opts.group);
  if (grp) conds.push(inArray(schema.shipments.status, grp.statuses));
  if (opts.payment === "cod" || opts.payment === "prepaid" || opts.payment === "fod") conds.push(eq(schema.orders.paymentType, opts.payment));
  // dashboard buckets + date range: identical conditions to the dashboard counts
  if (isBucket(opts.bucket)) { const c = bucketCondition(opts.bucket); if (c) conds.push(c); }
  if (opts.from || opts.to || isBucket(opts.bucket)) conds.push(rangeCondition(dashRange({ from: opts.from, to: opts.to }))!);
  if (opts.mode === "B2B" || opts.mode === "B2C") conds.push(eq(schema.orders.mode, opts.mode));
  if (opts.tag) conds.push(sql`exists (select 1 from ${schema.orderTagLinks} l join ${schema.orderTags} t on t.id = l.tag_id where l.order_id = ${schema.orders.id} and t.id = ${opts.tag} and t.org_id = ${orgId})`);
  if (opts.q) {
    const q = `%${opts.q.trim().replace(/[%_]/g, "")}%`;
    conds.push(or(ilike(schema.orders.orderNumber, q), ilike(schema.shipments.awb, q), ilike(schema.shipments.lrNumber, q),
      sql`${schema.orders.consignee}->>'mobile' ilike ${q}`)!);
  }
  const where = and(...conds);
  const rows = await db.select({
    orderId: schema.orders.id, orderNumber: schema.orders.orderNumber, createdAt: schema.orders.createdAt,
    mode: schema.orders.mode, paymentType: schema.orders.paymentType, codAmount: schema.orders.codAmountPaise,
    consignee: schema.orders.consignee, orderStatus: schema.orders.status,
    shipmentId: schema.shipments.id, awb: schema.shipments.awb, lr: schema.shipments.lrNumber, carrierCode: schema.shipments.carrierCode,
    carrierName: schema.shipments.carrierName, status: schema.shipments.status, chargeable: schema.shipments.chargeableWeightGrams,
    sell: schema.shipments.sellPaise, provider: schema.shipments.provider,
    boxes: sql<number>`(select coalesce(sum(${schema.packages.count}),0) from ${schema.packages} where ${schema.packages.orderId} = ${schema.orders.id})`,
    enteredGrams: sql<number>`(select coalesce(sum(${schema.packages.count} * ${schema.packages.actualWeightGrams}),0) from ${schema.packages} where ${schema.packages.orderId} = ${schema.orders.id})`,
    dims: sql<string | null>`(select string_agg(round(${schema.packages.lengthMm}/10.0,1)::text || '×' || round(${schema.packages.breadthMm}/10.0,1)::text || '×' || round(${schema.packages.heightMm}/10.0,1)::text, ', ') from ${schema.packages} where ${schema.packages.orderId} = ${schema.orders.id})`,
    carrierGrams: schema.shipments.carrierWeightGrams,
  }).from(schema.orders).leftJoin(schema.shipments, eq(schema.shipments.orderId, schema.orders.id))
    .where(where).orderBy(desc(schema.orders.createdAt)).limit(pageSize).offset((page - 1) * pageSize);
  const [{ total }] = await db.select({ total: count() }).from(schema.orders).leftJoin(schema.shipments, eq(schema.shipments.orderId, schema.orders.id)).where(where);
  return { rows, total: Number(total), page, pageSize };
}

export async function recentTransactions(walletId: string | null, limit = 6) {
  if (!walletId) return [];
  const db = await getDb();
  return db.select().from(schema.ledgerEntries).where(eq(schema.ledgerEntries.walletId, walletId)).orderBy(desc(schema.ledgerEntries.createdAt)).limit(limit);
}

export async function getOrderDetail(orgId: string, orderId: string) {
  const db = await getDb();
  const [order] = await db.select().from(schema.orders).where(and(eq(schema.orders.id, orderId), eq(schema.orders.orgId, orgId)));
  if (!order) return null;
  const pkgs = await db.select().from(schema.packages).where(eq(schema.packages.orderId, orderId));
  const [shipment] = await db.select().from(schema.shipments).where(and(eq(schema.shipments.orderId, orderId), eq(schema.shipments.orgId, orgId)));
  const events = shipment ? await db.select().from(schema.shipmentEvents).where(eq(schema.shipmentEvents.shipmentId, shipment.id)).orderBy(desc(schema.shipmentEvents.occurredAt)) : [];
  const [warehouse] = order.warehouseId ? await db.select().from(schema.warehouses).where(and(eq(schema.warehouses.id, order.warehouseId), eq(schema.warehouses.orgId, orgId))) : [];
  const [quote] = shipment ? await db.select().from(schema.quotes).where(eq(schema.quotes.id, shipment.quoteId)) : [];
  return { order, pkgs, shipment, events, warehouse, quote };
}
