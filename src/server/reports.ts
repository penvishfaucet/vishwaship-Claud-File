import "server-only";
import { and, asc, desc, eq, gte, inArray, lte, sql, type SQL, gt } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { STATUS_GROUPS, statusLabel } from "@/lib/status";

/**
 * Customer reports. Every query is scoped by orgId (from the session) and uses the SAME filter
 * function for the screen and the download, so totals always match.
 */
export const REPORTS = {
  shipments: { title: "Shipment Report", desc: "Every shipment by AWB / LR with courier, warehouse, status, booked and delivered dates, weights and charges." },
  orders: { title: "Orders Reports", desc: "All orders — including those awaiting shipment — with sales channel, payment, order value and fulfilment status." },
  ndr: { title: "NDR Reports", desc: "Failed-delivery reasons, attempt dates, your responses, action status and final outcome." },
  delivery: { title: "Delivery Performance", desc: "Delivered shipments with days taken and ETA met / missed." },
  rto: { title: "RTO Report", desc: "Shipments returned to origin." },
  cod: { title: "COD Remittance", desc: "Cash-on-delivery orders and their collection / remittance state." },
  weight: { title: "Weight Discrepancy", desc: "Carrier re-weigh disputes, charges and outcomes." },
  custom: { title: "Custom Report", desc: "Pick the columns you need from the shipment data." },
} as const;
export type ReportKey = keyof typeof REPORTS;

export interface ReportFilters {
  from?: string; to?: string; status?: string; payment?: string; mode?: string; carrier?: string; q?: string; tag?: string; columns?: string[];
}

type Col = { key: string; label: string; get: (r: Row) => unknown };
type Row = Record<string, unknown> & {
  s?: typeof schema.shipments.$inferSelect | null; o: typeof schema.orders.$inferSelect;
  n?: typeof schema.ndrCases.$inferSelect; w?: typeof schema.weightDisputes.$inferSelect; deliveredAt?: Date | null;
};

const ist = (d: Date | null | undefined) => (d ? d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "");
const rs = (p: number | null | undefined) => (p == null ? "" : (p / 100).toFixed(2));
const cons = (r: Row) => r.o.consignee as { name: string; city: string; pincode: string; state: string };

/** Column catalogue for shipment-based reports (also the Custom report's choices). */
export const SHIPMENT_COLUMNS: Col[] = [
  { key: "booked_at", label: "Booked (IST)", get: (r) => ist(r.s?.createdAt) },
  { key: "order", label: "Order ID", get: (r) => r.o.orderNumber },
  { key: "awb", label: "AWB / LR", get: (r) => r.s?.awb ?? "" },
  { key: "carrier", label: "Courier", get: (r) => r.s?.carrierName ?? "" },
  { key: "service", label: "Service", get: (r) => r.s?.serviceName ?? "" },
  { key: "mode", label: "Type", get: (r) => r.o.mode },
  { key: "payment", label: "Payment", get: (r) => r.o.paymentType },
  { key: "cod", label: "COD amount (INR)", get: (r) => rs(r.o.codAmountPaise) },
  { key: "declared", label: "Declared value (INR)", get: (r) => rs(r.o.declaredValuePaise) },
  { key: "buyer", label: "Buyer", get: (r) => cons(r).name },
  { key: "city", label: "City", get: (r) => cons(r).city },
  { key: "state", label: "State", get: (r) => cons(r).state },
  { key: "pincode", label: "PIN", get: (r) => cons(r).pincode },
  { key: "status", label: "Status", get: (r) => (r.s ? statusLabel(r.s.status) : r.o.status) },
  { key: "chargeable", label: "Chargeable kg", get: (r) => (r.s ? (r.s.chargeableWeightGrams / 1000).toFixed(2) : "") },
  { key: "charged", label: "Charged incl. GST (INR)", get: (r) => rs(r.s?.sellPaise) },
  { key: "eta", label: "ETA", get: (r) => ist(r.s?.etaDate) },
  { key: "last_update", label: "Last update (IST)", get: (r) => ist(r.s?.lastEventAt) },
  { key: "source", label: "Sales channel", get: (r) => r.o.source },
  { key: "warehouse", label: "Warehouse", get: (r) => (r.o.pickupSnapshot as { label?: string; pincode?: string } | null)?.label ?? "" },
  { key: "delivered_at", label: "Delivered (IST)", get: (r) => ist(r.deliveredAt ?? (r.s?.status === "delivered" ? r.s.lastEventAt : null)) },
  { key: "carrier_kg", label: "Courier-measured kg", get: (r) => (r.s?.carrierWeightGrams ? (r.s.carrierWeightGrams / 1000).toFixed(2) : "") },
  { key: "order_value", label: "Order value (INR)", get: (r) => rs((r.o.products as Array<{ qty: number; unitPrice: number }>).reduce((t, p) => t + p.qty * p.unitPrice, 0)) },
];
const pick = (keys: string[]) => keys.map((k) => SHIPMENT_COLUMNS.find((c) => c.key === k)!).filter(Boolean);

function columnsFor(key: ReportKey, f: ReportFilters): Col[] {
  switch (key) {
    case "shipments": return pick(["booked_at", "order", "awb", "carrier", "warehouse", "mode", "payment", "cod", "buyer", "city", "pincode", "status", "delivered_at", "chargeable", "carrier_kg", "charged", "eta"]);
    case "orders": return [{ key: "created", label: "Created (IST)", get: (r) => ist(r.o.createdAt) }, ...pick(["order", "source", "mode", "payment", "order_value", "cod", "declared", "buyer", "city", "pincode"]), { key: "ostatus", label: "Fulfilment status", get: (r) => r.o.status.replace(/_/g, " ") }, ...pick(["awb", "carrier", "status"])];
    case "ndr": return [{ key: "raised", label: "Raised (IST)", get: (r) => ist(r.n?.createdAt) }, ...pick(["order", "awb", "carrier", "buyer", "city"]), { key: "reason", label: "Reason", get: (r) => r.n?.reason ?? "" }, { key: "attempt", label: "Attempt", get: (r) => r.n?.attempt ?? "" }, { key: "deadline", label: "Action deadline", get: (r) => ist(r.n?.deadlineAt) }, { key: "case", label: "Case status", get: (r) => r.n?.status ?? "" }, { key: "action", label: "Your response", get: (r) => r.n?.requestedAction?.replace(/_/g, " ") ?? "" }, { key: "outcome", label: "Final outcome", get: (r) => (r.s ? (["delivered", "rto_delivered", "rto_in_transit", "rto_initiated", "lost"].includes(r.s.status) ? statusLabel(r.s.status) : "In progress") : "") }];
    case "delivery": return [...pick(["booked_at", "order", "awb", "carrier", "city", "pincode"]), { key: "delivered", label: "Delivered (IST)", get: (r) => ist(r.deliveredAt) }, { key: "days", label: "Days taken", get: (r) => (r.deliveredAt && r.s ? ((r.deliveredAt.getTime() - r.s.createdAt.getTime()) / 86400_000).toFixed(1) : "") }, { key: "eta_met", label: "ETA met", get: (r) => (r.deliveredAt && r.s?.etaDate ? (r.deliveredAt <= r.s.etaDate ? "Yes" : "No") : "") }];
    case "rto": return pick(["booked_at", "order", "awb", "carrier", "payment", "cod", "buyer", "city", "status", "charged", "last_update"]);
    case "cod": return [...pick(["booked_at", "order", "awb", "carrier", "cod", "status"]), { key: "remit", label: "Remittance", get: (r) => (r.s?.status === "delivered" ? "Awaiting carrier remittance" : ["rto_initiated", "rto_in_transit", "rto_delivered", "cancelled"].includes(r.s?.status ?? "") ? "Not collectable (RTO/cancelled)" : "Not yet collected") }];
    case "weight": return [{ key: "raised", label: "Raised (IST)", get: (r) => ist(r.w?.createdAt) }, ...pick(["order", "awb", "carrier"]), { key: "declared_kg", label: "Declared kg", get: (r) => ((r.w?.declaredGrams ?? 0) / 1000).toFixed(2) }, { key: "carrier_kg", label: "Carrier kg", get: (r) => ((r.w?.carrierGrams ?? 0) / 1000).toFixed(2) }, { key: "revised_kg", label: "Revised chargeable kg", get: (r) => ((r.w?.revisedChargeableGrams ?? 0) / 1000).toFixed(2) }, { key: "extra", label: "Extra charge (INR)", get: (r) => rs(r.w?.chargePaise) }, { key: "deadline", label: "Dispute by", get: (r) => ist(r.w?.deadlineAt) }, { key: "outcome", label: "Status", get: (r) => r.w?.status ?? "" }];
    case "custom": {
      const chosen = (f.columns ?? []).filter((k) => SHIPMENT_COLUMNS.some((c) => c.key === k));
      return pick(chosen.length ? chosen : ["booked_at", "order", "awb", "carrier", "status"]);
    }
  }
}

function dateRange(f: ReportFilters) {
  const from = f.from ? new Date(`${f.from}T00:00:00+05:30`) : new Date(Date.now() - 30 * 86400_000);
  const to = f.to ? new Date(`${f.to}T23:59:59.999+05:30`) : new Date();
  return { from, to };
}

/** Run a report for one customer. Returns columns, rows (as display values) and status counts. */
export async function runReport(orgId: string, key: ReportKey, f: ReportFilters, limit = 5000) {
  const db = await getDb();
  const { from, to } = dateRange(f);
  const conds: SQL[] = [eq(schema.orders.orgId, orgId)];
  if (f.payment === "cod" || f.payment === "prepaid") conds.push(eq(schema.orders.paymentType, f.payment));
  if (f.mode === "B2B" || f.mode === "B2C") conds.push(eq(schema.orders.mode, f.mode));
  if (f.tag) conds.push(sql`exists (select 1 from ${schema.orderTagLinks} l join ${schema.orderTags} t on t.id = l.tag_id where l.order_id = ${schema.orders.id} and t.id = ${f.tag} and t.org_id = ${orgId})`);
  let raw: Row[] = [];

  if (key === "orders") {
    conds.push(gte(schema.orders.createdAt, from), lte(schema.orders.createdAt, to));
    raw = (await db.select({ o: schema.orders, s: schema.shipments }).from(schema.orders).leftJoin(schema.shipments, eq(schema.shipments.orderId, schema.orders.id)).where(and(...conds)).orderBy(desc(schema.orders.createdAt)).limit(limit)) as Row[];
  } else if (key === "ndr") {
    conds.push(eq(schema.ndrCases.orgId, orgId), gte(schema.ndrCases.createdAt, from), lte(schema.ndrCases.createdAt, to));
    raw = (await db.select({ n: schema.ndrCases, s: schema.shipments, o: schema.orders }).from(schema.ndrCases).innerJoin(schema.shipments, eq(schema.shipments.id, schema.ndrCases.shipmentId)).innerJoin(schema.orders, eq(schema.orders.id, schema.shipments.orderId)).where(and(...conds)).orderBy(desc(schema.ndrCases.createdAt)).limit(limit)) as Row[];
  } else if (key === "weight") {
    conds.push(eq(schema.weightDisputes.orgId, orgId), gte(schema.weightDisputes.createdAt, from), lte(schema.weightDisputes.createdAt, to));
    raw = (await db.select({ w: schema.weightDisputes, s: schema.shipments, o: schema.orders }).from(schema.weightDisputes).innerJoin(schema.shipments, eq(schema.shipments.id, schema.weightDisputes.shipmentId)).innerJoin(schema.orders, eq(schema.orders.id, schema.shipments.orderId)).where(and(...conds)).orderBy(desc(schema.weightDisputes.createdAt)).limit(limit)) as Row[];
  } else {
    conds.push(eq(schema.shipments.orgId, orgId), gte(schema.shipments.createdAt, from), lte(schema.shipments.createdAt, to));
    if (key === "delivery") conds.push(eq(schema.shipments.status, "delivered"));
    if (key === "rto") conds.push(inArray(schema.shipments.status, ["rto_initiated", "rto_in_transit", "rto_delivered"]));
    if (key === "cod") conds.push(gt(schema.orders.codAmountPaise, 0));
    if (f.carrier) conds.push(eq(schema.shipments.carrierCode, f.carrier));
    raw = (await db.select({ s: schema.shipments, o: schema.orders }).from(schema.shipments).innerJoin(schema.orders, eq(schema.orders.id, schema.shipments.orderId)).where(and(...conds)).orderBy(desc(schema.shipments.createdAt)).limit(limit)) as Row[];
    if (key === "delivery" && raw.length) {
      const ev = await db.select().from(schema.shipmentEvents).where(and(inArray(schema.shipmentEvents.shipmentId, raw.map((r) => r.s!.id)), eq(schema.shipmentEvents.status, "delivered"))).orderBy(asc(schema.shipmentEvents.occurredAt));
      for (const r of raw) r.deliveredAt = ev.find((e) => e.shipmentId === r.s!.id)?.occurredAt ?? r.s!.lastEventAt;
    }
  }

  // Free-text search (order, AWB, buyer name/city)
  if (f.q?.trim()) {
    const q = f.q.trim().toLowerCase();
    raw = raw.filter((r) => [r.o.orderNumber, r.s?.awb, cons(r).name, cons(r).city, cons(r).pincode].some((v) => String(v ?? "").toLowerCase().includes(q)));
  }
  // Status counts BEFORE the status filter, so the chips show the full picture
  const counts: Array<{ key: string; label: string; count: number }> = key === "ndr"
    ? ["open", "action_requested", "acknowledged", "closed"].map((k) => ({ key: k, label: k.replace("_", " "), count: raw.filter((r) => r.n?.status === k).length }))
    : key === "weight"
      ? ["open", "disputed", "charged", "waived"].map((k) => ({ key: k, label: k, count: raw.filter((r) => r.w?.status === k).length }))
      : STATUS_GROUPS.map((g) => ({ key: g.key, label: g.label, count: raw.filter((r) => r.s && g.statuses.includes(r.s.status)).length }));
  if (f.status) {
    const g = STATUS_GROUPS.find((x) => x.key === f.status);
    raw = raw.filter((r) => key === "ndr" ? r.n?.status === f.status : key === "weight" ? r.w?.status === f.status : g ? r.s && g.statuses.includes(r.s.status) : true);
  }
  const cols = columnsFor(key, f);
  return { columns: cols.map((c) => ({ key: c.key, label: c.label })), rows: raw.map((r) => cols.map((c) => c.get(r))), counts, total: raw.length, from, to };
}

export function parseFilters(sp: URLSearchParams | Record<string, string | undefined>): ReportFilters {
  const g = (k: string) => (sp instanceof URLSearchParams ? sp.get(k) ?? undefined : sp[k]) || undefined;
  const cols = g("columns");
  return { from: g("from"), to: g("to"), status: g("status"), payment: g("payment"), mode: g("mode"), carrier: g("carrier"), q: g("q"), tag: g("tag"), columns: cols ? cols.split(",") : undefined };
}
