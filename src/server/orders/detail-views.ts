import "server-only";
import { type SQL, and, asc, desc, eq, inArray } from "drizzle-orm";
import { hideProviders } from "@/server/customer-safe";
import { getDb, schema } from "@/server/db/client";
import { timeline } from "@/server/tracking/service";

/**
 * Data behind the Orders "Track" and "WhatsApp COD" dialogs, shared by the Customer Portal (orgId = the session's
 * account; other accounts' records are "not found") and Admin (orgId = null; caller must be staff).
 */
const scoped = (col: Parameters<typeof eq>[0], orgId: string | null): SQL | undefined => (orgId ? eq(col, orgId) : undefined);

export async function shipmentTimeline(shipmentId: string, orgId: string | null, opts: { customerSafe: boolean }) {
  const db = await getDb();
  const [sh] = await db.select().from(schema.shipments).where(and(eq(schema.shipments.id, shipmentId), scoped(schema.shipments.orgId, orgId)));
  if (!sh) return null;
  const [o] = await db.select({ orderNumber: schema.orders.orderNumber, consignee: schema.orders.consignee }).from(schema.orders).where(eq(schema.orders.id, sh.orderId));
  const events = await timeline(shipmentId);
  const amendments = await db.select().from(schema.destinationAmendments).where(eq(schema.destinationAmendments.shipmentId, shipmentId)).orderBy(desc(schema.destinationAmendments.occurredAt));
  const c = o.consignee as { city?: string; state?: string; pincode?: string };
  return {
    orderNumber: o.orderNumber, carrier: sh.carrierName, service: sh.serviceName, awb: sh.awb, lr: sh.lrNumber && sh.lrNumber !== sh.awb ? sh.lrNumber : null,
    status: sh.status, etaDate: sh.etaDate,
    pickup: { status: sh.pickupStatus, date: sh.pickupDate, requestId: sh.pickupRequestId, agentName: sh.pickupAgentName, agentPhone: sh.pickupAgentPhone },
    delivery: deliveryAgent(events), deliveredAt: sh.deliveredAt, lastLocation: sh.lastLocation, lastEventAt: sh.lastEventAt,
    lastSyncAt: sh.lastSyncAt, lastSyncError: sh.lastSyncError ? (opts.customerSafe ? hideProviders(sh.lastSyncError) : sh.lastSyncError) : null,
    syncFailures: sh.syncFailures, demo: sh.provider === "demo",
    destination: { city: c.city, state: c.state, pincode: c.pincode },
    events: events.slice().reverse().map((e) => ({ status: e.status, raw: e.rawStatus, location: e.location, at: e.occurredAt, remark: e.remark, source: e.source })),
    amendments: amendments.map((a) => ({ at: a.occurredAt, previous: addr(a.previous), next: addr(a.next) })),
  };
}

/** Delivery executive, when the courier puts a name / phone in an out-for-delivery scan remark. */
function deliveryAgent(events: Array<{ status: string; remark: string | null; rawStatus: string | null }>) {
  for (const e of events.slice().reverse()) {
    if (e.status !== "out_for_delivery") continue;
    const t = `${e.remark ?? ""} ${e.rawStatus ?? ""}`;
    const phone = t.match(/(?:\+91[-\s]?)?([6-9]\d{9})/)?.[1] ?? null;
    const name = t.match(/(?:executive|agent|rider|boy|fe|sr)\s*(?:name)?\s*[:-]\s*([A-Za-z][A-Za-z .]{1,40})/i)?.[1]?.trim() ?? null;
    if (phone || name) return { name, phone };
  }
  return null;
}
const addr = (v: unknown) => { const a = v as Record<string, string>; return [a.line1, a.line2, a.city, a.state, a.pincode].filter(Boolean).join(", "); };

const BUTTON: Record<string, string> = { confirm: "Confirm Order", cancel: "Cancel Order" };

/** WhatsApp COD confirmation history for one order: messages, buyer reply, cancellation, refund. */
export async function codHistory(orderId: string, orgId: string | null) {
  const db = await getDb();
  const [o] = await db.select({ id: schema.orders.id, orgId: schema.orders.orgId, orderNumber: schema.orders.orderNumber, paymentType: schema.orders.paymentType, cod: schema.orders.codAmountPaise })
    .from(schema.orders).where(and(eq(schema.orders.id, orderId), scoped(schema.orders.orgId, orgId)));
  if (!o) return null;
  const org = o.orgId; // every lookup below stays inside the order's own account
  const [c] = await db.select().from(schema.codConfirmations).where(and(eq(schema.codConfirmations.orderId, orderId), eq(schema.codConfirmations.orgId, org)));
  const msgs = await db.select().from(schema.whatsappMessages)
    .where(and(eq(schema.whatsappMessages.orderId, orderId), eq(schema.whatsappMessages.orgId, org), eq(schema.whatsappMessages.event, "cod_confirmation"))).orderBy(asc(schema.whatsappMessages.createdAt));
  const ships = await db.select({ id: schema.shipments.id }).from(schema.shipments).where(and(eq(schema.shipments.orderId, orderId), eq(schema.shipments.orgId, org)));
  const log = await db.select({ action: schema.auditLog.action, at: schema.auditLog.createdAt }).from(schema.auditLog)
    .where(and(eq(schema.auditLog.orgId, org), inArray(schema.auditLog.targetId, [orderId, ...ships.map((x) => x.id)]))).orderBy(desc(schema.auditLog.createdAt)).limit(50);
  const [refund] = ships.length ? await db.select({ amount: schema.ledgerEntries.amountPaise, at: schema.ledgerEntries.createdAt, memo: schema.ledgerEntries.memo }).from(schema.ledgerEntries)
    .where(inArray(schema.ledgerEntries.idempotencyKey, ships.map((x) => `refund:cancel:${x.id}`))) : [];
  return {
    orderNumber: o.orderNumber, paymentType: o.paymentType, codPaise: o.cod,
    confirmation: c ? {
      status: c.status, sentAt: c.sentAt, expiresAt: c.expiresAt, decidedAt: c.decidedAt, buyerResponse: c.buyerResponse,
      buttonLabel: c.buyerResponse ? BUTTON[c.buyerResponse] ?? c.buyerResponse : null,
      cancellationStatus: c.cancellationStatus, cancellationReason: c.cancellationReason, cancellationAt: c.cancellationAt,
    } : null,
    messages: msgs.map((m) => ({ at: m.createdAt, updatedAt: m.updatedAt, status: m.status, to: m.recipientMasked, template: m.templateName, error: m.error, response: m.buyerResponse, respondedAt: m.respondedAt, demo: m.isDemo })),
    activity: log.filter((l) => l.action.startsWith("cod.") || l.action.startsWith("shipment.cancel") || l.action === "order.cancel").map((l) => ({ action: l.action, at: l.at })),
    refund: refund ? { amountPaise: refund.amount, at: refund.at, memo: refund.memo } : null,
  };
}
