import "server-only";
import { type SQL, and, count, desc, eq, gte, ilike, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { eventIncluded } from "@/server/features";
import { bucketCondition, isBucket } from "@/server/portal/buckets";
import { type CodInputs, type TabKey, LEGACY_GROUP, PAGE_SIZES, STATUS_TAB, isTab } from "@/lib/order-view";
import type { PricedQuote } from "@/server/pricing/engine";
import { labelFormatsFor } from "@/server/labels/formats";

const O = schema.orders, S = schema.shipments;

export interface OrderFilters {
  tab: TabKey;
  direction: "forward" | "reverse";
  dateType: "created" | "booked" | "delivered";
  from: string; to: string; // IST yyyy-mm-dd
  ref?: string; awb?: string; q?: string;
  courier?: string; type?: "B2C" | "B2B" | "MPS"; payment?: "prepaid" | "cod" | "fod";
  warehouse?: string; status?: string; cod?: string; tag?: string; bucket?: string;
  /** Admin only: one customer account (org id). Ignored in the Customer Portal, which is always its own org. */
  customer?: string;
  /** Admin quick filters: bookings still being confirmed, or in-transit shipments without a scan for 72 h. */
  exception?: "booking" | "stale";
  page: number; pageSize: number;
}

const day = /^\d{4}-\d{2}-\d{2}$/;
const istToday = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const minus = (d: string, days: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() - days * 86400_000).toISOString().slice(0, 10);
const pick = <T extends string>(v: unknown, allowed: readonly T[]): T | undefined => (allowed as readonly unknown[]).includes(v) ? (v as T) : undefined;
const clean = (v: unknown, max = 60) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

/** Dashboard tiles (?bucket=) open the matching tab, so both show the same numbers. */
const BUCKET_TAB: Record<string, TabKey> = { new: "new", assigned: "courier_assigned", scheduled: "pickups", in_transit: "in_transit", ofd: "out_for_delivery", delivered: "delivered", ndr: "ndr", rto_in_transit: "rto_in_transit", rto_delivered: "rto_delivered", all: "all", returns: "all" };

/** Parse URL params (untrusted) into filters. Defaults: Forward, Order Created, last 30 days (IST). */
export function parseOrderFilters(sp: Record<string, string | undefined>): OrderFilters {
  const today = istToday();
  const legacyTab = sp.group ? LEGACY_GROUP[sp.group] : sp.bucket ? BUCKET_TAB[sp.bucket] : undefined;
  // dashboard tiles link with a bucket + their own range; keep that range
  const to = sp.to && day.test(sp.to) ? sp.to : today;
  const from = sp.from && day.test(sp.from) ? sp.from : minus(to, 29);
  const size = Number(sp.size);
  return {
    tab: isTab(sp.tab) ? sp.tab : legacyTab ?? "all",
    direction: sp.direction === "reverse" || sp.bucket === "returns" ? "reverse" : "forward",
    dateType: pick(sp.dateType, ["created", "booked", "delivered"] as const) ?? "created",
    from: from > to ? to : from, to,
    ref: clean(sp.ref), awb: clean(sp.awb), q: clean(sp.q),
    courier: clean(sp.courier, 40), type: pick(sp.type, ["B2C", "B2B", "MPS"] as const), payment: pick(sp.payment, ["prepaid", "cod", "fod"] as const),
    warehouse: clean(sp.warehouse, 40), status: clean(sp.status, 30), customer: clean(sp.customer, 64), exception: pick(sp.exception, ["booking", "stale"] as const), cod: clean(sp.cod, 30), tag: clean(sp.tag, 40), bucket: sp.bucket === "rto" ? "rto" : undefined,
    page: Math.max(1, Math.min(10_000, Number(sp.page) || 1)),
    pageSize: (PAGE_SIZES as readonly number[]).includes(size) ? size : 25,
  };
}

/** Latest shipment of each order (an order may have a failed booking before a successful one). */
const latestShipment = sql`${S.id} = (select s2.id from ${S} s2 where s2.order_id = ${O.id} order by s2.created_at desc limit 1)`;
const boxesSql = sql<number>`(select coalesce(sum(p.count),0) from ${schema.packages} p where p.order_id = ${O.id})`;

/** SQL twin of tabOf() in lib/order-view.ts. */
export function tabSql(): SQL<string> {
  const byStatus = Object.entries(STATUS_TAB).filter(([s]) => s !== "booked").map(([s, t]) => sql`when ${S.status} = ${s} then ${t}`);
  return sql<string>`case
    when ${O.archivedAt} is not null then 'archive'
    when ${O.status} = 'cancelled' then 'other'
    when ${S.id} is null and ${O.status} = 'draft' then 'drafts'
    when ${S.id} is null or ${S.bookingStatus} = 'failed' then 'new'
    when ${S.status} = 'cancelled' then 'other'
    when ${S.status} = 'booked' then case when ${S.pickupStatus} = 'not_scheduled' then 'courier_assigned' else 'pickups' end
    ${sql.join(byStatus, sql` `)}
    else 'other' end`;
}

const COD_SQL: Record<string, SQL> = {
  pending: sql`c.status in ('pending','needs_review') and c.cancellation_status is null`,
  confirmed: sql`c.status = 'confirmed'`,
  rejected: sql`c.status = 'rejected'`,
  no_response: sql`c.status in ('no_response','expired')`,
  message_failed: sql`c.status = 'send_failed'`,
  cancellation_pending: sql`c.cancellation_status = 'requested'`,
  cancelled: sql`c.cancellation_status = 'cancelled'`,
  cancellation_failed: sql`c.cancellation_status in ('failed','action_required')`,
};

/**
 * Every condition except the tab (counts use these too, so tab numbers match the filtered list).
 * orgId null = every account (Admin All Shipments only — callers check staff permission); f.customer narrows it.
 */
function baseConditions(orgId: string | null, f: OrderFilters): SQL[] {
  const c: SQL[] = [eq(O.direction, f.direction)];
  if (orgId) c.push(eq(O.orgId, orgId));
  else if (f.customer) c.push(eq(O.orgId, f.customer));
  const from = new Date(`${f.from}T00:00:00+05:30`), to = new Date(`${f.to}T23:59:59.999+05:30`);
  const col = f.dateType === "booked" ? S.createdAt : f.dateType === "delivered" ? S.deliveredAt : O.createdAt;
  c.push(gte(col, from), lte(col, to));
  if (f.bucket && isBucket(f.bucket)) { const b = bucketCondition(f.bucket); if (b) c.push(b); }
  const like = (v: string) => `%${v.replace(/[%_\\]/g, "")}%`;
  if (f.ref) c.push(or(ilike(O.orderNumber, like(f.ref)), ilike(O.externalOrderId, like(f.ref)), ilike(O.invoiceNumber, like(f.ref)))!);
  if (f.awb) c.push(or(ilike(S.awb, like(f.awb)), ilike(S.lrNumber, like(f.awb)))!);
  if (f.q) c.push(or(ilike(O.orderNumber, like(f.q)), ilike(S.awb, like(f.q)), ilike(S.lrNumber, like(f.q)), sql`${O.consignee}->>'mobile' ilike ${like(f.q)}`,
    ...(orgId ? [] : [sql`exists (select 1 from ${schema.orgs} g where g.id = ${O.orgId} and (g.business_name ilike ${like(f.q)} or g.id = ${f.q}))`]))!);
  if (f.courier) c.push(eq(S.carrierCode, f.courier));
  if (f.type === "B2B") c.push(eq(O.mode, "B2B"));
  if (f.type === "B2C") c.push(and(eq(O.mode, "B2C"), sql`${boxesSql} <= 1`)!);
  if (f.type === "MPS") c.push(and(eq(O.mode, "B2C"), sql`${boxesSql} > 1`)!);
  if (f.payment) c.push(eq(O.paymentType, f.payment));
  if (f.warehouse) c.push(eq(O.warehouseId, f.warehouse));
  if (f.status) c.push(f.status === "not_booked" ? isNull(S.id) : eq(S.status, f.status));
  if (f.cod && COD_SQL[f.cod]) c.push(sql`exists (select 1 from ${schema.codConfirmations} c where c.order_id = ${O.id} and ${COD_SQL[f.cod]})`);
  if (f.exception === "booking") c.push(inArray(S.bookingStatus, ["pending", "ambiguous"]));
  if (f.exception === "stale") c.push(and(inArray(S.status, ["in_transit", "picked_up"]), lte(S.lastEventAt, new Date(Date.now() - 72 * 3600_000)))!);
  if (f.tag && orgId) c.push(sql`exists (select 1 from ${schema.orderTagLinks} l join ${schema.orderTags} t on t.id = l.tag_id where l.order_id = ${O.id} and t.id = ${f.tag} and t.org_id = ${orgId})`);
  return c;
}

function tabCondition(tab: TabKey): SQL | undefined {
  if (tab === "all") return isNull(O.archivedAt);
  if (tab === "archive") return isNotNull(O.archivedAt);
  return sql`${tabSql()} = ${tab}`;
}

export async function tabCounts(orgId: string | null, f: OrderFilters): Promise<Record<TabKey, number>> {
  const db = await getDb();
  // group in an outer query: the CASE carries bound parameters, so Postgres cannot match it in GROUP BY directly
  const inner = db.select({ tab: sql<string>`${tabSql()}`.as("tab") }).from(O).leftJoin(S, latestShipment).where(and(...baseConditions(orgId, f))).as("t");
  const rows = await db.select({ tab: inner.tab, n: count() }).from(inner).groupBy(inner.tab);
  const by = Object.fromEntries(rows.map((r) => [r.tab, Number(r.n)]));
  const sum = (k: string[]) => k.reduce((s, x) => s + (by[x] ?? 0), 0);
  return {
    drafts: sum(["drafts"]), new: sum(["new"]), courier_assigned: sum(["courier_assigned"]), pickups: sum(["pickups"]),
    in_transit: sum(["in_transit"]), out_for_delivery: sum(["out_for_delivery"]), delivered: sum(["delivered"]),
    ndr: sum(["ndr"]), rto_in_transit: sum(["rto_in_transit"]), rto_delivered: sum(["rto_delivered"]),
    all: Object.entries(by).filter(([k]) => k !== "archive").reduce((s, [, n]) => s + n, 0), archive: sum(["archive"]),
  };
}

export type ChargeLine = { label: string; amount: number };
type Addr = { name?: string; mobile?: string; line1?: string; line2?: string; city?: string; district?: string; state?: string; pincode?: string; label?: string; contactName?: string };

/** One page of orders with everything the row shows. Tenant-scoped by orgId (from the session, never input). */
export async function listOrderRows(orgId: string, f: OrderFilters, opts: { limit?: number; offset?: number } = {}) {
  const db = await getDb();
  const conds = baseConditions(orgId, f);
  const tc = tabCondition(f.tab); if (tc) conds.push(tc);
  const where = and(...conds);
  const limit = opts.limit ?? f.pageSize, offset = opts.offset ?? (f.page - 1) * f.pageSize;
  const base = (await db.select({ o: O, s: S }).from(O).leftJoin(S, latestShipment).where(where).orderBy(desc(O.createdAt)).limit(limit).offset(offset))
    .map((r) => (r.s?.bookingStatus === "failed" ? { o: r.o, s: null } : r)); // a failed booking is shown as not shipped (New)
  const [{ total }] = await db.select({ total: count() }).from(O).leftJoin(S, latestShipment).where(where);
  const orderIds = base.map((r) => r.o.id);
  const shipIds = base.flatMap((r) => (r.s ? [r.s.id] : []));
  const quoteIds = base.flatMap((r) => (r.s ? [r.s.quoteId] : []));
  const whIds = [...new Set(base.flatMap((r) => (r.o.warehouseId ? [r.o.warehouseId] : [])))];
  const none = <T,>(): T[] => [];
  const [pkgs, quotes, warehouses, cods, msgs, disputes, lastEvents, tags] = await Promise.all([
    orderIds.length ? db.select().from(schema.packages).where(inArray(schema.packages.orderId, orderIds)) : none<typeof schema.packages.$inferSelect>(),
    quoteIds.length ? db.select({ id: schema.quotes.id, priced: schema.quotes.priced, total: schema.quotes.totalPaise }).from(schema.quotes).where(inArray(schema.quotes.id, quoteIds)) : none<{ id: string; priced: unknown; total: number }>(),
    whIds.length ? db.select().from(schema.warehouses).where(and(eq(schema.warehouses.orgId, orgId), inArray(schema.warehouses.id, whIds))) : none<typeof schema.warehouses.$inferSelect>(),
    orderIds.length ? db.select().from(schema.codConfirmations).where(and(eq(schema.codConfirmations.orgId, orgId), inArray(schema.codConfirmations.orderId, orderIds))) : none<typeof schema.codConfirmations.$inferSelect>(),
    orderIds.length ? db.select({ orderId: schema.whatsappMessages.orderId, status: schema.whatsappMessages.status, at: schema.whatsappMessages.updatedAt }).from(schema.whatsappMessages)
      .where(and(eq(schema.whatsappMessages.orgId, orgId), eq(schema.whatsappMessages.event, "cod_confirmation"), inArray(schema.whatsappMessages.orderId, orderIds))).orderBy(desc(schema.whatsappMessages.createdAt)) : none<{ orderId: string | null; status: string; at: Date }>(),
    shipIds.length ? db.select().from(schema.weightDisputes).where(and(eq(schema.weightDisputes.orgId, orgId), inArray(schema.weightDisputes.shipmentId, shipIds))) : none<typeof schema.weightDisputes.$inferSelect>(),
    shipIds.length ? db.selectDistinctOn([schema.shipmentEvents.shipmentId], { shipmentId: schema.shipmentEvents.shipmentId, location: schema.shipmentEvents.location, at: schema.shipmentEvents.occurredAt, raw: schema.shipmentEvents.rawStatus })
      .from(schema.shipmentEvents).where(inArray(schema.shipmentEvents.shipmentId, shipIds)).orderBy(schema.shipmentEvents.shipmentId, desc(schema.shipmentEvents.occurredAt)) : none<{ shipmentId: string; location: string | null; at: Date; raw: string | null }>(),
    orderIds.length ? db.select({ orderId: schema.orderTagLinks.orderId, id: schema.orderTags.id, name: schema.orderTags.name, color: schema.orderTags.color }).from(schema.orderTagLinks)
      .innerJoin(schema.orderTags, eq(schema.orderTags.id, schema.orderTagLinks.tagId)).where(and(eq(schema.orderTags.orgId, orgId), inArray(schema.orderTagLinks.orderId, orderIds))) : none<{ orderId: string; id: string; name: string; color: string }>(),
  ]);
  const codIncluded = await eventIncluded(orgId, "whatsapp:cod_confirmation");
  const [toggle] = await db.select({ enabled: schema.notificationSettings.enabled }).from(schema.notificationSettings)
    .where(and(eq(schema.notificationSettings.orgId, orgId), eq(schema.notificationSettings.channel, "whatsapp"), eq(schema.notificationSettings.event, "cod_confirmation")));

  const rows = base.map(({ o, s }) => {
    const p = pkgs.filter((x) => x.orderId === o.id);
    const boxes = p.reduce((t, x) => t + x.count, 0);
    const actual = p.reduce((t, x) => t + x.count * x.actualWeightGrams, 0);
    const volumetric = p.reduce((t, x) => t + x.count * Math.ceil((x.lengthMm / 10) * (x.breadthMm / 10) * (x.heightMm / 10) * 1000 / 5000), 0);
    const q = s ? quotes.find((x) => x.id === s.quoteId) : undefined;
    const priced = q?.priced as PricedQuote | undefined;
    const dispute = s ? disputes.find((d) => d.shipmentId === s.id && ["charged", "accepted"].includes(d.status)) : undefined;
    const charged = s ? s.sellPaise + (dispute?.chargePaise ?? 0) : null;
    const lines: ChargeLine[] = priced?.lines?.map((l) => ({ label: l.label, amount: l.sellPreTax })) ?? [];
    const cod = cods.find((c) => c.orderId === o.id) ?? null;
    const msg = msgs.find((m) => m.orderId === o.id);
    const ev = s ? lastEvents.find((e) => e.shipmentId === s.id) : undefined;
    const wh = warehouses.find((w) => w.id === o.warehouseId);
    const snap = (o.pickupSnapshot ?? null) as Addr | null;
    const pickup: Addr | null = snap ?? (wh ? { label: wh.label, contactName: wh.contactName, mobile: wh.mobile, line1: wh.line1, line2: wh.line2 ?? undefined, city: wh.city, state: wh.state, pincode: wh.pincode } : null);
    const codIn: CodInputs = { paymentType: o.paymentType, included: codIncluded, enabled: toggle ? toggle.enabled : null, confirmation: cod ? { status: cod.status, cancellationStatus: cod.cancellationStatus } : null, messageStatus: msg?.status ?? null };
    return {
      id: o.id, orderNumber: o.orderNumber, createdAt: o.createdAt.toISOString(), source: o.source, mode: o.mode, direction: o.direction,
      orderStatus: o.status, archived: !!o.archivedAt, externalOrderId: o.externalOrderId, invoiceNumber: o.invoiceNumber,
      products: ((o.products as Array<{ name: string; sku?: string; qty: number; unitPrice?: number }>) ?? []).map((x) => ({ name: x.name, sku: x.sku ?? "", qty: x.qty })),
      boxes, isMps: o.mode === "B2C" && boxes > 1,
      packages: p.map((x) => ({ count: x.count, l: x.lengthMm / 10, b: x.breadthMm / 10, h: x.heightMm / 10, kg: x.actualWeightGrams / 1000 })),
      actualGrams: actual, volumetricGrams: volumetric,
      chargeableGrams: s?.chargeableWeightGrams ?? null, carrierGrams: s?.carrierWeightGrams ?? null,
      payment: o.paymentType, invoicePaise: o.declaredValuePaise, codPaise: o.codAmountPaise,
      chargedPaise: charged, bookedPaise: s?.sellPaise ?? null, receiverFreightPaise: s?.receiverFreightPaise ?? 0,
      breakdown: s ? { lines, gst: priced?.gst ?? null, quoteTotal: q?.total ?? null, booked: s.sellPaise, adjustment: dispute ? { amount: dispute.chargePaise ?? 0, label: `Weight discrepancy (${dispute.status})`, at: dispute.createdAt.toISOString() } : null, total: charged! } : null,
      consignee: o.consignee as Addr,
      pickup,
      shipment: s ? {
        id: s.id, provider: s.provider, carrierCode: s.carrierCode, carrierName: s.carrierName, serviceName: s.serviceName,
        awb: s.awb, lr: s.lrNumber && s.lrNumber !== s.awb ? s.lrNumber : null, pieces: Array.isArray(s.pieceIds) ? (s.pieceIds as string[]).length : 0,
        bookingStatus: s.bookingStatus, status: s.status, pickupStatus: s.pickupStatus,
        lastLocation: s.lastLocation ?? ev?.location ?? null, lastEventAt: (s.lastEventAt ?? ev?.at)?.toISOString() ?? null, lastRaw: ev?.raw ?? null,
        lastSyncAt: s.lastSyncAt?.toISOString() ?? null, lastSyncError: s.lastSyncError, syncFailures: s.syncFailures,
        etaDate: s.etaDate?.toISOString() ?? null, deliveredAt: s.deliveredAt?.toISOString() ?? null,
        labelFormats: labelFormatsFor(s.provider),
        cancellable: s.bookingStatus === "confirmed" && ["booked", "pickup_pending"].includes(s.status) && o.status !== "cancelled",
      } : null,
      cancellableOrder: !s && ["draft", "ready", "cod_hold", "booking_failed"].includes(o.status),
      cod: codIn, codDecidedAt: cod?.decidedAt?.toISOString() ?? null, codResponse: cod?.buyerResponse ?? null,
      tags: tags.filter((t) => t.orderId === o.id).map((t) => ({ id: t.id, name: t.name, color: t.color })),
    };
  });
  return { rows, total: Number(total), page: f.page, pageSize: f.pageSize };
}
export type OrderRow = Awaited<ReturnType<typeof listOrderRows>>["rows"][number];

/**
 * Admin → All Shipments: every account's orders with the Customer Portal's tabs, filters and status logic
 * (same baseConditions / tabSql / tabOf), plus the customer. Callers must hold shipments.read (staff).
 */
export async function adminOrderRows(f: OrderFilters) {
  const db = await getDb();
  const conds = baseConditions(null, f);
  const tc = tabCondition(f.tab); if (tc) conds.push(tc);
  const where = and(...conds);
  const base = await db.select({ o: O, s: S, org: { id: schema.orgs.id, name: schema.orgs.businessName } }).from(O).leftJoin(S, latestShipment)
    .innerJoin(schema.orgs, eq(schema.orgs.id, O.orgId)).where(where).orderBy(desc(O.createdAt)).limit(f.pageSize).offset((f.page - 1) * f.pageSize);
  const [{ total }] = await db.select({ total: count() }).from(O).leftJoin(S, latestShipment).where(where);
  const ids = base.map((r) => r.o.id);
  const boxes = ids.length ? await db.select({ orderId: schema.packages.orderId, n: sql<number>`sum(${schema.packages.count})::int` }).from(schema.packages).where(inArray(schema.packages.orderId, ids)).groupBy(schema.packages.orderId) : [];
  const rows = base.map(({ o, s: raw, org }) => {
    const s = raw?.bookingStatus === "failed" ? null : raw;
    const n = boxes.find((b) => b.orderId === o.id)?.n ?? 1;
    return {
      id: o.id, orderNumber: o.orderNumber, createdAt: o.createdAt, customer: org,
      type: o.mode === "B2B" ? "B2B" : n > 1 ? "MPS" : "B2C", payment: o.paymentType, orderStatus: o.status, archived: !!o.archivedAt,
      shipment: s ? { id: s.id, awb: s.awb, lr: s.lrNumber && s.lrNumber !== s.awb ? s.lrNumber : null, carrierCode: s.carrierCode, carrierName: s.carrierName, provider: s.provider, bookedAt: s.createdAt, status: s.status, bookingStatus: s.bookingStatus, pickupStatus: s.pickupStatus } : null,
    };
  });
  return { rows, total: Number(total), page: f.page, pageSize: f.pageSize };
}

/** Courier and customer options for the Admin filters. */
export async function adminFilterOptions() {
  const db = await getDb();
  const [couriers, customers] = await Promise.all([
    db.selectDistinct({ code: S.carrierCode, name: S.carrierName }).from(S).limit(200),
    db.select({ id: schema.orgs.id, name: schema.orgs.businessName }).from(schema.orgs).orderBy(schema.orgs.businessName).limit(2000),
  ]);
  const seen = new Set<string>();
  return { couriers: couriers.filter((c) => !seen.has(c.code) && seen.add(c.code)).sort((a, b) => a.name.localeCompare(b.name)), customers };
}

/** Filter dropdown options (only this org's own data). */
export async function filterOptions(orgId: string) {
  const db = await getDb();
  const [couriers, warehouses, tags] = await Promise.all([
    db.selectDistinct({ code: S.carrierCode, name: S.carrierName }).from(S).where(eq(S.orgId, orgId)).limit(100),
    db.select({ id: schema.warehouses.id, label: schema.warehouses.label }).from(schema.warehouses).where(eq(schema.warehouses.orgId, orgId)),
    db.select({ id: schema.orderTags.id, name: schema.orderTags.name }).from(schema.orderTags).where(eq(schema.orderTags.orgId, orgId)),
  ]);
  const seen = new Set<string>();
  return { couriers: couriers.filter((c) => !seen.has(c.code) && seen.add(c.code)).sort((a, b) => a.name.localeCompare(b.name)), warehouses, tags };
}

