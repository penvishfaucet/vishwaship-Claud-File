import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db/client";
import { eventIncluded } from "@/server/features";
import { credit as walletCredit } from "@/server/ledger/wallet";
import { withLedger } from "@/server/ledger/db-store";
import { getAdapter, providerContext } from "@/server/providers/registry";
import { getSetting } from "@/server/quotes/service";
import { ensurePublicRef } from "@/server/tracking/service";
import { newId } from "@/server/util/ids";
import { enqueue } from "@/server/jobs/runner";
import { decisionFromReply, parseWatiWebhook, watiSendTemplate } from "./wati";

export type WaEvent = "out_for_delivery" | "cod_confirmation";
export const WA_EVENT_LABEL: Record<WaEvent, string> = { out_for_delivery: "Out for Delivery", cod_confirmation: "COD Confirmation" };

export interface CodSettings { reminderMinutes: number; expiryMinutes: number; noReply: "release" | "hold_for_review" | "cancel"; credits: number }
export const COD_DEFAULTS: CodSettings = { reminderMinutes: 120, expiryMinutes: 1440, noReply: "release", credits: 2 };
export const codSettings = async () => ({ ...COD_DEFAULTS, ...(await getSetting<Partial<CodSettings>>("cod_confirmation", COD_DEFAULTS)).value }) as CodSettings;

/** Shipment states where a carrier will still accept a cancellation (before pickup). */
export const PRE_PICKUP = ["booked", "pickup_pending"];

const maskPhone = (e164: string) => `${e164.slice(0, 3)}••••••${e164.slice(-4)}`;
const appUrl = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

/** The enabled WATI account, or null. */
export async function watiAccount() {
  const db = await getDb();
  const [a] = await db.select().from(schema.providerAccounts).where(and(eq(schema.providerAccounts.adapter, "wati"), eq(schema.providerAccounts.status, "enabled")));
  return a ?? null;
}

/** Demo mode = no WATI account and not production. Never active in production. */
export async function whatsappMode(): Promise<"live" | "demo" | "unconfigured"> {
  if (await watiAccount()) return "live";
  return process.env.NODE_ENV === "production" ? "unconfigured" : "demo";
}

async function creditCost(event: WaEvent) {
  if (event === "cod_confirmation") return (await codSettings()).credits;
  const c = await getSetting("notification_credit_cost", { sms: 1, whatsapp: 1, email: 0, webhook: 0, cod_confirmation: 2 });
  return c.value.whatsapp ?? 1;
}

/** Deduct notification credits once per message (idempotent on the message id). */
async function chargeCredits(orgId: string, msgId: string, n: number): Promise<boolean> {
  if (n <= 0) return true;
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [done] = await tx.select({ id: schema.creditEntries.id }).from(schema.creditEntries).where(eq(schema.creditEntries.idempotencyKey, `wa:charge:${msgId}`));
    if (done) return true;
    const upd = await tx.update(schema.creditBalances).set({ credits: sql`${schema.creditBalances.credits} - ${n}` })
      .where(and(eq(schema.creditBalances.orgId, orgId), sql`${schema.creditBalances.credits} >= ${n}`)).returning({ c: schema.creditBalances.credits });
    if (!upd.length) return false;
    await tx.insert(schema.creditEntries).values({ id: newId("ce"), orgId, kind: "settle", credits: -n, idempotencyKey: `wa:charge:${msgId}`, refType: "whatsapp_message", refId: msgId });
    return true;
  });
}

async function refundCredits(orgId: string, msgId: string, n: number) {
  if (n <= 0) return;
  const db = await getDb();
  await db.transaction(async (tx) => {
    const ins = await tx.insert(schema.creditEntries).values({ id: newId("ce"), orgId, kind: "release", credits: n, idempotencyKey: `wa:refund:${msgId}`, refType: "whatsapp_message", refId: msgId }).onConflictDoNothing().returning({ id: schema.creditEntries.id });
    if (ins.length) await tx.update(schema.creditBalances).set({ credits: sql`${schema.creditBalances.credits} + ${n}` }).where(eq(schema.creditBalances.orgId, orgId));
  });
}

export type SendOutcome = { status: "sent" | "skipped" | "failed" | "duplicate"; reason?: string; retryable?: boolean; messageId?: string };

/**
 * Send one WhatsApp template message. Every gate is checked on the server, every time:
 * plan/event access → customer toggle → recipient → provider → approved template → credits.
 * `dedupeKey` makes retries and duplicate triggers safe (one row, at most one charge, at most one send).
 */
export async function sendEvent(a: { event: WaEvent; orgId: string; orderId: string; shipmentId?: string | null; dedupeKey: string }): Promise<SendOutcome> {
  const db = await getDb();
  const [order] = await db.select().from(schema.orders).where(and(eq(schema.orders.id, a.orderId), eq(schema.orders.orgId, a.orgId)));
  if (!order) return { status: "skipped", reason: "Order not found" };
  const consignee = order.consignee as { name?: string; mobile?: string };
  const digits = String(consignee.mobile ?? "").replace(/\D/g, "").slice(-10);
  const toE164 = /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : "";

  await db.insert(schema.whatsappMessages).values({ id: newId("wam"), orgId: a.orgId, orderId: a.orderId, shipmentId: a.shipmentId ?? null, event: a.event, recipientMasked: toE164 ? maskPhone(toE164) : "—", dedupeKey: a.dedupeKey, status: "queued" }).onConflictDoNothing();
  const [msg] = await db.select().from(schema.whatsappMessages).where(eq(schema.whatsappMessages.dedupeKey, a.dedupeKey));
  if (msg.status !== "queued") return { status: "duplicate", messageId: msg.id };

  const finish = async (status: "sent" | "skipped" | "failed", patch: Partial<typeof schema.whatsappMessages.$inferInsert> = {}) => {
    await db.update(schema.whatsappMessages).set({ status, updatedAt: new Date(), ...patch }).where(eq(schema.whatsappMessages.id, msg.id));
    return { status, reason: patch.error ?? undefined, messageId: msg.id } as SendOutcome;
  };

  if (!(await eventIncluded(a.orgId, `whatsapp:${a.event}`))) return finish("skipped", { error: "Not included in the customer's plan" });
  const [toggle] = await db.select().from(schema.notificationSettings).where(and(eq(schema.notificationSettings.orgId, a.orgId), eq(schema.notificationSettings.channel, "whatsapp"), eq(schema.notificationSettings.event, a.event)));
  if (!toggle?.enabled) return finish("skipped", { error: "Turned off by the customer" });
  if (a.event === "out_for_delivery") {
    const [master] = await db.select().from(schema.notificationSettings).where(and(eq(schema.notificationSettings.orgId, a.orgId), eq(schema.notificationSettings.channel, "whatsapp"), eq(schema.notificationSettings.event, "*")));
    if (master && !master.enabled) return finish("skipped", { error: "WhatsApp notifications switched off by the customer" });
  }
  if (!toE164) return finish("failed", { error: "Buyer mobile number is missing or invalid" });

  const mode = await whatsappMode();
  if (mode === "unconfigured") return finish("failed", { error: "WhatsApp provider not configured" });
  const [tpl] = await db.select().from(schema.notificationTemplates).where(and(eq(schema.notificationTemplates.channel, "whatsapp"), eq(schema.notificationTemplates.event, a.event), eq(schema.notificationTemplates.approvalState, "approved"))).orderBy(desc(schema.notificationTemplates.updatedAt));
  if (mode === "live" && !tpl?.providerTemplateName) return finish("failed", { error: "No approved WhatsApp template mapped for this event" });
  const templateName = tpl?.providerTemplateName ?? `demo_${a.event}`;

  const cost = mode === "demo" ? 0 : await creditCost(a.event);
  if (!(await chargeCredits(a.orgId, msg.id, cost))) return finish("failed", { error: "Insufficient notification credits", templateName });

  const [org] = await db.select().from(schema.orgs).where(eq(schema.orgs.id, a.orgId));
  const [ship] = a.shipmentId ? await db.select().from(schema.shipments).where(eq(schema.shipments.id, a.shipmentId)) : [];
  const params: Record<string, string> = {
    buyer_name: String(consignee.name ?? "Customer").split(" ")[0],
    order_id: order.orderNumber,
    merchant_name: org?.businessName ?? "your seller",
    cod_amount: `₹${(order.codAmountPaise / 100).toLocaleString("en-IN")}`,
  };
  if (ship) {
    params.carrier = ship.carrierName;
    params.awb = ship.awb ?? "";
    params.tracking_link = `${appUrl()}/t/${await ensurePublicRef(ship.id)}`;
  }

  if (mode === "demo") return finish("sent", { templateName, providerMessageId: `demo_${msg.id}`, isDemo: true });

  const acct = (await watiAccount())!;
  const r = await watiSendTemplate(await providerContext(acct), { toE164, templateName, broadcastName: `${a.event}_${order.orderNumber}`.slice(0, 60), params });
  if (r.ok) {
    await db.update(schema.providerAccounts).set({ lastSuccessAt: new Date() }).where(eq(schema.providerAccounts.id, acct.id));
    return finish("sent", { templateName, providerMessageId: r.providerMessageId ?? null, creditsCharged: cost });
  }
  if (r.retryable) {
    // keep the row queued (and the credits charged) so the job retry re-uses them
    await db.update(schema.whatsappMessages).set({ error: r.error, templateName, creditsCharged: cost, updatedAt: new Date() }).where(eq(schema.whatsappMessages.id, msg.id));
    return { status: "failed", reason: r.error, retryable: true, messageId: msg.id };
  }
  await refundCredits(a.orgId, msg.id, cost);
  return finish("failed", { templateName, error: r.error ?? "Send failed" });
}

/** After the job gives up on a retryable failure: mark failed and give the credits back. */
export async function giveUp(dedupeKey: string, reason: string) {
  const db = await getDb();
  const [m] = await db.select().from(schema.whatsappMessages).where(eq(schema.whatsappMessages.dedupeKey, dedupeKey));
  if (!m || m.status !== "queued") return;
  await refundCredits(m.orgId, m.id, m.creditsCharged);
  await db.update(schema.whatsappMessages).set({ status: "failed", error: reason, creditsCharged: 0, updatedAt: new Date() }).where(eq(schema.whatsappMessages.id, m.id));
}

/** COD confirmation send (job cod.send). Order stays on hold; failures are surfaced to the customer. */
export async function sendCodConfirmation(orderId: string): Promise<SendOutcome> {
  const db = await getDb();
  const [c] = await db.select().from(schema.codConfirmations).where(eq(schema.codConfirmations.orderId, orderId));
  if (!c || c.status !== "pending" || c.sentAt) return { status: "duplicate" };
  const r = await sendEvent({ event: "cod_confirmation", orgId: c.orgId, orderId, dedupeKey: `wa:cod:${orderId}` });
  if (r.status === "sent" || r.status === "duplicate") {
    if (r.status === "sent") await db.update(schema.codConfirmations).set({ sentAt: new Date() }).where(eq(schema.codConfirmations.id, c.id));
    return r;
  }
  if (r.retryable) return r;
  await codSendFailed(orderId, r.reason ?? "Send failed");
  return r;
}

/** Order stays on hold; customer is told so they can release or cancel it manually. */
export async function codSendFailed(orderId: string, reason: string) {
  const db = await getDb();
  const [c] = await db.update(schema.codConfirmations).set({ status: "send_failed" }).where(and(eq(schema.codConfirmations.orderId, orderId), eq(schema.codConfirmations.status, "pending"))).returning();
  if (!c) return;
  await db.insert(schema.inAppAlerts).values({ id: newId("al"), orgId: c.orgId, kind: "cod", title: `COD confirmation not sent: ${reason}. Order is on hold — release or cancel it.`, href: "/portal/notifications/cod/?status=send_failed" });
  await audit({ actorKind: "system", orgId: c.orgId, action: "cod.send_failed", targetType: "order", targetId: orderId, details: { reason } });
}

export type DecisionResult = { ok: boolean; status?: string; cancellation?: string | null; message: string };

/**
 * Apply a buyer (or customer/admin) decision exactly once.
 * confirm → Confirmed, hold released (order ready to ship).
 * cancel  → Rejected, then: not booked → order cancelled; booked & before pickup → carrier cancellation job;
 *           already picked up / in transit → Action Required (customer must handle, e.g. RTO).
 */
export async function applyDecision(a: { confirmationId: string; decision: "confirm" | "cancel"; source: "buyer" | "customer" | "admin" | "simulator"; actorUserId?: string; replyMessageId?: string }): Promise<DecisionResult> {
  const db = await getDb();
  const status = a.decision === "confirm" ? "confirmed" : "rejected";
  const [c] = await db.update(schema.codConfirmations)
    .set({ status, buyerResponse: a.source === "buyer" || a.source === "simulator" ? a.decision : null, decidedAt: new Date(), replyMessageId: a.replyMessageId ?? null })
    .where(and(eq(schema.codConfirmations.id, a.confirmationId), inArray(schema.codConfirmations.status, ["pending", "no_response", "needs_review", "send_failed", "expired"])))
    .returning();
  if (!c) return { ok: false, message: "Already decided — duplicate or late response ignored" };
  await db.update(schema.whatsappMessages).set({ buyerResponse: a.decision, respondedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(schema.whatsappMessages.orderId, c.orderId), eq(schema.whatsappMessages.event, "cod_confirmation")));
  await audit({ actorUserId: a.actorUserId, actorKind: a.source === "admin" ? "staff" : a.source === "customer" ? "customer" : "system", orgId: c.orgId, action: `cod.${status}`, targetType: "order", targetId: c.orderId, details: { source: a.source } });

  if (a.decision === "confirm") {
    await db.update(schema.orders).set({ status: "ready" }).where(and(eq(schema.orders.id, c.orderId), eq(schema.orders.status, "cod_hold")));
    await db.insert(schema.inAppAlerts).values({ id: newId("al"), orgId: c.orgId, kind: "cod", title: "Buyer confirmed a COD order — it is ready to ship.", href: `/portal/orders/${c.orderId}/` });
    return { ok: true, status, message: "Confirmed — order released for shipping" };
  }
  const cancellation = await startCancellation(c.id, "Buyer cancelled via WhatsApp COD confirmation");
  return { ok: true, status, cancellation, message: `Rejected — cancellation ${cancellation}` };
}

async function setCancellation(confirmationId: string, s: "requested" | "cancelled" | "failed" | "action_required", reason: string | null) {
  const db = await getDb();
  await db.update(schema.codConfirmations).set({ cancellationStatus: s, cancellationReason: reason, cancellationAt: new Date() }).where(eq(schema.codConfirmations.id, confirmationId));
}

async function startCancellation(confirmationId: string, reason: string) {
  const db = await getDb();
  const [c] = await db.select().from(schema.codConfirmations).where(eq(schema.codConfirmations.id, confirmationId));
  const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, c.orderId));
  const [ship] = await db.select().from(schema.shipments).where(and(eq(schema.shipments.orderId, c.orderId), inArray(schema.shipments.bookingStatus, ["confirmed", "pending", "ambiguous"])));
  if (!ship) {
    if (order.status === "booking" || order.status === "needs_reconcile") {
      await setCancellation(c.id, "action_required", "A booking is in progress — cancel it from the order once the AWB is assigned");
      await alert(c.orgId, c.orderId, "Buyer cancelled a COD order while it was being booked — action required.");
      return "action_required";
    }
    await db.update(schema.orders).set({ status: "cancelled" }).where(eq(schema.orders.id, c.orderId));
    await setCancellation(c.id, "cancelled", reason);
    return "cancelled";
  }
  if (!PRE_PICKUP.includes(ship.status) || ship.bookingStatus !== "confirmed") {
    await setCancellation(c.id, "action_required", `Shipment is ${ship.status.replaceAll("_", " ")} — the courier no longer accepts cancellation. Arrange RTO.`);
    await alert(c.orgId, c.orderId, `Buyer cancelled COD order but shipment ${ship.awb ?? ""} is already ${ship.status.replaceAll("_", " ")} — action required.`);
    return "action_required";
  }
  await setCancellation(c.id, "requested", reason);
  await enqueue("cod.cancel", { confirmationId: c.id, shipmentId: ship.id }, { dedupeKey: `cod.cancel:${ship.id}` });
  return "requested";
}

async function alert(orgId: string, orderId: string, title: string) {
  const db = await getDb();
  await db.insert(schema.inAppAlerts).values({ id: newId("al"), orgId, kind: "cod", title, href: `/portal/orders/${orderId}/` });
}

/** Job cod.cancel — ask the carrier to cancel; refund the shipping charge once on acknowledgement. */
export async function runCarrierCancellation(confirmationId: string, shipmentId: string, attempt: number): Promise<{ done: true } | { retryInSec: number; error?: string }> {
  const db = await getDb();
  const [c] = await db.select().from(schema.codConfirmations).where(eq(schema.codConfirmations.id, confirmationId));
  const [ship] = await db.select().from(schema.shipments).where(eq(schema.shipments.id, shipmentId));
  if (!c || !ship || c.cancellationStatus !== "requested") return { done: true };
  if (!PRE_PICKUP.includes(ship.status)) {
    await setCancellation(c.id, "action_required", `Shipment moved to ${ship.status.replaceAll("_", " ")} before the courier cancelled it.`);
    await alert(c.orgId, c.orderId, "COD cancellation could not be completed — the shipment was already picked up. Action required.");
    return { done: true };
  }
  const [acct] = await db.select().from(schema.providerAccounts).where(eq(schema.providerAccounts.id, ship.providerAccountId));
  const adapter = acct ? getAdapter(acct.adapter) : null;
  if (!acct || !adapter) { await setCancellation(c.id, "failed", "Courier account unavailable"); return { done: true }; }
  const r = await adapter.cancel(await providerContext(acct), { providerOrderRef: ship.providerOrderRef ?? ship.orderId, awb: ship.awb });
  if (!r.ok) {
    if (r.error.retryable && attempt < 5) return { retryInSec: 60 * attempt, error: r.error.message };
    await setCancellation(c.id, "failed", `Courier refused: ${r.error.message}`.slice(0, 300));
    await alert(c.orgId, c.orderId, `Courier did not cancel shipment ${ship.awb ?? ""}: ${r.error.message}. Cancel it manually or contact support.`);
    await audit({ actorKind: "system", orgId: c.orgId, action: "cod.cancellation_failed", targetType: "shipment", targetId: ship.id, details: { error: r.error.message } });
    return { done: true };
  }
  if (!r.value.acknowledged) {
    await setCancellation(c.id, "failed", "Courier did not acknowledge the cancellation");
    await alert(c.orgId, c.orderId, `Courier did not acknowledge cancellation of ${ship.awb ?? ""}. Action required.`);
    return { done: true };
  }
  await db.update(schema.shipments).set({ bookingStatus: "cancelled", status: "cancelled" }).where(eq(schema.shipments.id, ship.id));
  await db.update(schema.orders).set({ status: "cancelled" }).where(eq(schema.orders.id, c.orderId));
  const [wallet] = await db.select().from(schema.wallets).where(eq(schema.wallets.orgId, c.orgId));
  if (wallet && ship.sellPaise > 0) {
    await withLedger((s) => walletCredit(s, { walletId: wallet.id, amount: ship.sellPaise, kind: "refund_credit", idempotencyKey: `refund:cancel:${ship.id}`, refType: "shipment", refId: ship.id, memo: `Refund: COD order cancelled by buyer${ship.awb ? ` · ${ship.awb}` : ""}` }));
  }
  await setCancellation(c.id, "cancelled", "Cancelled with courier; shipping charge refunded to wallet");
  await audit({ actorKind: "system", orgId: c.orgId, action: "cod.cancelled_with_carrier", targetType: "shipment", targetId: ship.id, details: { refundPaise: ship.sellPaise } });
  return { done: true };
}

/** Sweep: pending confirmations past the admin timeout → No Response, then the admin-chosen action. */
export async function sweepNoResponse() {
  const db = await getDb();
  const cfg = await codSettings();
  const due = await db.update(schema.codConfirmations).set({ status: "no_response" })
    .where(and(eq(schema.codConfirmations.status, "pending"), sql`${schema.codConfirmations.expiresAt} <= now()`)).returning();
  for (const c of due) {
    await audit({ actorKind: "system", orgId: c.orgId, action: "cod.no_response", targetType: "order", targetId: c.orderId, details: { action: cfg.noReply } });
    if (cfg.noReply === "release") {
      await db.update(schema.orders).set({ status: "ready" }).where(and(eq(schema.orders.id, c.orderId), eq(schema.orders.status, "cod_hold")));
      await alert(c.orgId, c.orderId, "Buyer did not reply to the COD confirmation — the order stays active and is ready to ship.");
    } else if (cfg.noReply === "cancel") {
      await startCancellation(c.id, "No buyer response before the timeout");
    } else {
      await alert(c.orgId, c.orderId, "Buyer did not reply to the COD confirmation — review the order (ship or cancel).");
    }
  }
  return due.length;
}

/**
 * Inbound WATI webhook. Caller has already verified the secret token.
 * Dedupes on the provider message id; matches a reply to the right account/order via the replied-to
 * message id, else the buyer's phone when exactly one confirmation is open for it.
 */
export async function handleWatiWebhook(body: Record<string, unknown>): Promise<{ result: string }> {
  const db = await getDb();
  const p = parseWatiWebhook(body);
  const key = `wati:${p.eventType}:${p.msgId || JSON.stringify(body).length}`;
  const ins = await db.insert(schema.inboundEvents).values({ id: newId("ie"), provider: "wati", dedupeKey: key, verified: true, payloadRedacted: { eventType: p.eventType, waId: p.waId ? `••••${p.waId.slice(-4)}` : null, msgId: p.msgId, reply: p.replyText.slice(0, 40) } }).onConflictDoNothing().returning({ id: schema.inboundEvents.id });
  if (!ins.length) return { result: "duplicate" };
  const done = async (result: string) => { await db.update(schema.inboundEvents).set({ processedAt: new Date(), error: result.startsWith("ok") ? null : result }).where(eq(schema.inboundEvents.id, ins[0].id)); return { result }; };

  if (p.deliveryStatus && p.msgId) {
    await db.update(schema.whatsappMessages).set({ status: p.deliveryStatus, updatedAt: new Date() }).where(and(eq(schema.whatsappMessages.providerMessageId, p.msgId), inArray(schema.whatsappMessages.status, ["sent", "delivered"])));
    return done("ok:status");
  }
  if (!p.isReply) return done("ignored:event");
  const decision = decisionFromReply(p.replyText);
  if (!decision) return done("ignored:not_a_button");
  const c = await matchConfirmation(p.replyContextId, p.waId);
  if (!c) return done("unmatched");
  const r = await applyDecision({ confirmationId: c.id, decision, source: "buyer", replyMessageId: p.msgId });
  return done(r.ok ? `ok:${r.status}` : "ignored:already_decided");
}

async function matchConfirmation(contextId: string, waId: string) {
  const db = await getDb();
  if (contextId) {
    const [m] = await db.select().from(schema.whatsappMessages).where(and(eq(schema.whatsappMessages.providerMessageId, contextId), eq(schema.whatsappMessages.event, "cod_confirmation")));
    if (m?.orderId) {
      const [c] = await db.select().from(schema.codConfirmations).where(eq(schema.codConfirmations.orderId, m.orderId));
      if (c) return c;
    }
  }
  const last10 = waId.slice(-10);
  if (!/^[6-9]\d{9}$/.test(last10)) return null;
  const open = await db.select({ c: schema.codConfirmations }).from(schema.codConfirmations)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.codConfirmations.orderId))
    .where(and(inArray(schema.codConfirmations.status, ["pending", "no_response"]), sql`right(regexp_replace(${schema.orders.consignee}->>'mobile', '\\D', '', 'g'), 10) = ${last10}`));
  if (open.length === 1) return open[0].c;
  if (open.length > 1) {
    // ambiguous: same buyer has several open COD orders and WATI gave no reply context → manual review
    for (const o of open) await db.update(schema.codConfirmations).set({ status: "needs_review" }).where(eq(schema.codConfirmations.id, o.c.id));
  }
  return null;
}

/** Out-for-delivery trigger (job whatsapp.send). Only for active (non-terminal) shipments. */
export async function sendOutForDelivery(shipmentId: string, dedupeKey: string): Promise<SendOutcome> {
  const db = await getDb();
  const [ship] = await db.select().from(schema.shipments).where(eq(schema.shipments.id, shipmentId));
  if (!ship || ship.status !== "out_for_delivery") return { status: "skipped", reason: "Shipment no longer out for delivery" };
  return sendEvent({ event: "out_for_delivery", orgId: ship.orgId, orderId: ship.orderId, shipmentId, dedupeKey });
}
