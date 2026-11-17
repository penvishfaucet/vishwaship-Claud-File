import "server-only";
import { and, asc, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import type { PricedQuote } from "@/server/pricing/engine";

/** All billing reads are scoped by orgId taken from the session — never from the request. */

export const istStart = (d?: string) => (d ? new Date(`${d}T00:00:00+05:30`) : null);
export const istEnd = (d?: string) => (d ? new Date(`${d}T23:59:59.999+05:30`) : null);
export function range(sp: { from?: string; to?: string }, defaultDays = 30) {
  const to = istEnd(sp.to) ?? new Date();
  const from = istStart(sp.from) ?? new Date(to.getTime() - defaultDays * 86400_000);
  return { from, to };
}

export async function walletOf(orgId: string) {
  const db = await getDb();
  const [w] = await db.select().from(schema.wallets).where(eq(schema.wallets.orgId, orgId));
  return w ?? null;
}

/** Ledger statement: opening balance at `from`, entries in range, closing balance. */
export async function ledgerStatement(orgId: string, from: Date, to: Date) {
  const w = await walletOf(orgId);
  if (!w) return { opening: 0, closing: 0, entries: [] as Array<typeof schema.ledgerEntries.$inferSelect>, credits: 0, debits: 0 };
  const db = await getDb();
  const [before] = await db.select().from(schema.ledgerEntries).where(and(eq(schema.ledgerEntries.walletId, w.id), lt(schema.ledgerEntries.createdAt, from))).orderBy(desc(schema.ledgerEntries.createdAt)).limit(1);
  const entries = await db.select().from(schema.ledgerEntries).where(and(eq(schema.ledgerEntries.walletId, w.id), gte(schema.ledgerEntries.createdAt, from), lte(schema.ledgerEntries.createdAt, to))).orderBy(asc(schema.ledgerEntries.createdAt));
  const opening = before?.balanceAfterPaise ?? 0;
  const posted = entries.filter((e) => e.amountPaise !== 0);
  const credits = posted.filter((e) => e.amountPaise > 0).reduce((s, e) => s + e.amountPaise, 0);
  const debits = posted.filter((e) => e.amountPaise < 0).reduce((s, e) => s - e.amountPaise, 0);
  return { opening, closing: entries.length ? entries[entries.length - 1].balanceAfterPaise : opening, entries, credits, debits };
}

/** Shipping charges per AWB with the priced breakdown saved at booking, plus weight adjustments. */
export async function shippingCharges(orgId: string, from: Date, to: Date) {
  const db = await getDb();
  const rows = await db.select({ s: schema.shipments, o: schema.orders, q: schema.quotes }).from(schema.shipments)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.shipments.orderId))
    .leftJoin(schema.quotes, eq(schema.quotes.id, schema.shipments.quoteId))
    .where(and(eq(schema.shipments.orgId, orgId), gte(schema.shipments.createdAt, from), lte(schema.shipments.createdAt, to)))
    .orderBy(desc(schema.shipments.createdAt)).limit(2000);
  const ids = rows.map((r) => r.s.id);
  const disputes = ids.length ? await db.select().from(schema.weightDisputes).where(and(eq(schema.weightDisputes.orgId, orgId), inArray(schema.weightDisputes.shipmentId, ids))) : [];
  return rows.map(({ s, o, q }) => {
    const p = q?.priced as PricedQuote | undefined;
    const line = (codes: string[]) => (p?.lines ?? []).filter((l) => codes.includes(l.code)).reduce((t, l) => t + l.sellPreTax, 0);
    const SUR = ["fov", "oda", "handling", "rto", "reverse", "docket", "other"];
    const freight = p ? line(["freight", "fuel"]) : null;
    const d = disputes.find((x) => x.shipmentId === s.id && ["charged", "accepted"].includes(x.status));
    return {
      id: s.id, orderId: o.id, orderNumber: o.orderNumber, awb: s.awb, lr: s.lrNumber, carrier: s.carrierName, createdAt: s.createdAt, status: s.status,
      chargeableGrams: s.chargeableWeightGrams,
      freight, codFee: p ? line(["cod_fee"]) : null, surcharges: p ? line(SUR) : null,
      gst: p?.gst ?? null, weightAdjustment: d?.chargePaise ?? 0, total: s.sellPaise + (d?.chargePaise ?? 0),
      lines: p?.lines.map((l) => ({ label: l.label, sell: l.sellPreTax })) ?? [],
    };
  });
}

/** COD: per-shipment reconciliation + remittance batches. */
export async function codOverview(orgId: string) {
  const db = await getDb();
  const ships = await db.select({ o: schema.orders, s: schema.shipments, item: schema.codRemittanceItems, r: schema.codRemittances })
    .from(schema.shipments).innerJoin(schema.orders, eq(schema.orders.id, schema.shipments.orderId))
    .leftJoin(schema.codRemittanceItems, eq(schema.codRemittanceItems.shipmentId, schema.shipments.id))
    .leftJoin(schema.codRemittances, eq(schema.codRemittances.id, schema.codRemittanceItems.remittanceId))
    .where(and(eq(schema.shipments.orgId, orgId), eq(schema.orders.paymentType, "cod"))).orderBy(desc(schema.shipments.createdAt)).limit(1000);
  const batches = await db.select().from(schema.codRemittances).where(eq(schema.codRemittances.orgId, orgId)).orderBy(desc(schema.codRemittances.cycleDate));
  const live = batches.filter((b) => b.status !== "cancelled");
  const delivered = ships.filter((x) => x.s.status === "delivered");
  const collected = delivered.reduce((t, x) => t + x.o.codAmountPaise, 0);
  const paid = live.filter((b) => b.status === "paid").reduce((t, b) => t + b.netPaise, 0);
  const scheduled = live.filter((b) => b.status === "scheduled").reduce((t, b) => t + b.netPaise, 0);
  const deductions = live.reduce((t, b) => t + b.deductionsPaise, 0);
  const unbatched = delivered.filter((x) => !x.item || x.r?.status === "cancelled").reduce((t, x) => t + x.o.codAmountPaise, 0);
  const rows = ships.map(({ o, s, item, r }) => ({
    orderId: o.id, orderNumber: o.orderNumber, awb: s.awb, status: s.status, cod: o.codAmountPaise,
    remittance: r && r.status !== "cancelled" ? { id: r.id, status: r.status, reference: r.reference, expectedPayoutAt: r.expectedPayoutAt, paidAt: r.paidAt } : null,
    state: r && r.status === "paid" ? "Remitted" : r && r.status === "scheduled" ? "Scheduled" : s.status === "delivered" ? "Awaiting remittance" : ["rto_initiated", "rto_in_transit", "rto_delivered", "cancelled", "lost"].includes(s.status) ? "Not collectable" : "Not yet collected",
    item,
  }));
  return { rows, batches, totals: { collected, paid, scheduled, deductions, unbatched } };
}

export async function rechargesOf(orgId: string) {
  const db = await getDb();
  const rows = await db.select().from(schema.recharges).where(eq(schema.recharges.orgId, orgId)).orderBy(desc(schema.recharges.createdAt)).limit(500);
  const w = await walletOf(orgId);
  const credited = w && rows.length ? await db.select({ refId: schema.ledgerEntries.refId }).from(schema.ledgerEntries).where(and(eq(schema.ledgerEntries.walletId, w.id), eq(schema.ledgerEntries.kind, "recharge_credit"))) : [];
  const creditedIds = new Set(credited.map((c) => c.refId));
  return rows.map((r) => ({ ...r, walletCredited: creditedIds.has(r.id) || creditedIds.has(r.razorpayPaymentId ?? "") || creditedIds.has(r.razorpayOrderId ?? "") }));
}

export async function documentsOf(orgId: string, kind: "invoice" | "credit_note" | "debit_note") {
  const db = await getDb();
  return db.select().from(schema.billingDocuments).where(and(eq(schema.billingDocuments.orgId, orgId), eq(schema.billingDocuments.kind, kind))).orderBy(desc(schema.billingDocuments.docDate)).limit(500);
}

export async function creditHistory(orgId: string) {
  const db = await getDb();
  const rows = await db.select().from(schema.creditEntries).where(eq(schema.creditEntries.orgId, orgId)).orderBy(asc(schema.creditEntries.createdAt)).limit(5000);
  // running balance over the account's whole history, then newest first
  let bal = 0;
  const withBal = rows.map((r) => { bal += r.credits; return { ...r, balanceAfter: bal }; });
  const msgIds = rows.filter((r) => r.refType === "whatsapp_message" && r.refId).map((r) => r.refId!);
  const db2 = await getDb();
  const msgs = msgIds.length ? await db2.select({ id: schema.whatsappMessages.id, event: schema.whatsappMessages.event, orderId: schema.whatsappMessages.orderId }).from(schema.whatsappMessages).where(inArray(schema.whatsappMessages.id, msgIds)) : [];
  return withBal.reverse().map((r) => {
    const m = msgs.find((x) => x.id === r.refId);
    const type = r.kind === "purchase" ? "Purchase" : r.kind === "settle" ? "Usage" : r.kind === "release" ? "Refund (not sent)" : r.kind === "waiver" ? "Waiver" : r.kind === "adjustment" ? "Adjustment" : r.kind;
    return { ...r, type, event: m ? (m.event === "cod_confirmation" ? "WhatsApp COD Confirmation" : "WhatsApp Out for Delivery") : r.refType ?? "", orderId: m?.orderId ?? null };
  });
}

/** Next document number per kind and financial year: VS/INV/2026-27/00001. */
export async function nextDocNumber(kind: "invoice" | "credit_note" | "debit_note", at = new Date()) {
  const db = await getDb();
  const y = at.getMonth() >= 3 ? at.getFullYear() : at.getFullYear() - 1;
  const prefix = `VS/${kind === "invoice" ? "INV" : kind === "credit_note" ? "CN" : "DN"}/${y}-${String(y + 1).slice(2)}/`;
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.billingDocuments).where(sql`${schema.billingDocuments.number} like ${prefix + "%"}`);
  return `${prefix}${String((r?.n ?? 0) + 1).padStart(5, "0")}`;
}

/** Vishwaship company details printed on invoices / notes (Admin → Billing documents). */
export const COMPANY_DEFAULT = { legalName: "Vishwaship", gstin: "", address: "", stateCode: "", email: "support@vishwaship.com", sac: "996812" };

/** Issue a credit / debit note for an event exactly once (keyed by refType + refId + kind). Document only — no wallet effect. */
export async function issueAutoNote(a: { orgId: string; kind: "credit_note" | "debit_note"; totalPaise: number; reason: string; refType: string; refId: string; actor?: string }) {
  if (a.totalPaise <= 0) return null;
  const db = await getDb();
  const [dup] = await db.select({ id: schema.billingDocuments.id }).from(schema.billingDocuments).where(and(eq(schema.billingDocuments.orgId, a.orgId), eq(schema.billingDocuments.kind, a.kind), eq(schema.billingDocuments.refType, a.refType), eq(schema.billingDocuments.refId, a.refId)));
  if (dup) return dup.id;
  const { getSetting } = await import("@/server/quotes/service");
  const gstBps = (await getSetting<number>("gst_bps", 1800)).value;
  const taxable = Math.round((a.totalPaise * 10_000) / (10_000 + gstBps));
  const { newId } = await import("@/server/util/ids");
  const id = newId("doc");
  await db.insert(schema.billingDocuments).values({ id, orgId: a.orgId, kind: a.kind, number: await nextDocNumber(a.kind), docDate: new Date(), taxablePaise: taxable, gstPaise: a.totalPaise - taxable, totalPaise: a.totalPaise, reason: a.reason, refType: a.refType, refId: a.refId, lines: [{ description: a.reason, ref: a.refId, taxablePaise: taxable, gstPaise: a.totalPaise - taxable }], createdBy: a.actor ?? null });
  return id;
}
