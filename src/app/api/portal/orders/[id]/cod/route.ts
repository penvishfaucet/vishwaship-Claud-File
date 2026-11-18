import { NextResponse } from "next/server";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { apiCustomer } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { apiError } from "@/server/http";

const BUTTON: Record<string, string> = { confirm: "Confirm Order", cancel: "Cancel Order" };

/** WhatsApp COD confirmation history for one of this account's orders: messages, buyer reply, cancellation, refund. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const { id } = await params;
  const db = await getDb();
  const [o] = await db.select({ id: schema.orders.id, orderNumber: schema.orders.orderNumber, paymentType: schema.orders.paymentType, cod: schema.orders.codAmountPaise })
    .from(schema.orders).where(and(eq(schema.orders.id, id), eq(schema.orders.orgId, s.orgId)));
  if (!o) return apiError(404, "not_found", "Order not found");
  const [c] = await db.select().from(schema.codConfirmations).where(and(eq(schema.codConfirmations.orderId, id), eq(schema.codConfirmations.orgId, s.orgId)));
  const msgs = await db.select().from(schema.whatsappMessages)
    .where(and(eq(schema.whatsappMessages.orderId, id), eq(schema.whatsappMessages.orgId, s.orgId), eq(schema.whatsappMessages.event, "cod_confirmation"))).orderBy(asc(schema.whatsappMessages.createdAt));
  const ships = await db.select({ id: schema.shipments.id }).from(schema.shipments).where(and(eq(schema.shipments.orderId, id), eq(schema.shipments.orgId, s.orgId)));
  const log = await db.select({ action: schema.auditLog.action, at: schema.auditLog.createdAt }).from(schema.auditLog)
    .where(and(eq(schema.auditLog.orgId, s.orgId), inArray(schema.auditLog.targetId, [id, ...ships.map((x) => x.id)]))).orderBy(desc(schema.auditLog.createdAt)).limit(50);
  const [refund] = ships.length ? await db.select({ amount: schema.ledgerEntries.amountPaise, at: schema.ledgerEntries.createdAt, memo: schema.ledgerEntries.memo }).from(schema.ledgerEntries)
    .where(inArray(schema.ledgerEntries.idempotencyKey, ships.map((x) => `refund:cancel:${x.id}`))) : [];
  return NextResponse.json({
    orderNumber: o.orderNumber, paymentType: o.paymentType, codPaise: o.cod,
    confirmation: c ? {
      status: c.status, sentAt: c.sentAt, expiresAt: c.expiresAt, decidedAt: c.decidedAt, buyerResponse: c.buyerResponse,
      buttonLabel: c.buyerResponse ? BUTTON[c.buyerResponse] ?? c.buyerResponse : null,
      cancellationStatus: c.cancellationStatus, cancellationReason: c.cancellationReason, cancellationAt: c.cancellationAt,
    } : null,
    messages: msgs.map((m) => ({ at: m.createdAt, updatedAt: m.updatedAt, status: m.status, to: m.recipientMasked, template: m.templateName, error: m.error, response: m.buyerResponse, respondedAt: m.respondedAt, demo: m.isDemo })),
    activity: log.filter((l) => l.action.startsWith("cod.") || l.action.startsWith("shipment.cancel") || l.action === "order.cancel").map((l) => ({ action: l.action, at: l.at })),
    refund: refund ? { amountPaise: refund.amount, at: refund.at, memo: refund.memo } : null,
  });
}
