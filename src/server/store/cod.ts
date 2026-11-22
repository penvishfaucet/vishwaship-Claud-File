import "server-only";
import { and, desc, eq, gt, gte, inArray, lte, ne, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import type { PricedQuote } from "@/server/pricing/engine";
import { newId } from "@/server/util/ids";
import { StoreError } from "./catalog";

/**
 * COD money per shipment, as the merchant sees it. The buyer's cash is collected by the courier on delivery and
 * paid out to the merchant by Vishwaship in remittance batches (one batch covers many AWBs). The COD fee is part of
 * the shipping charge taken at booking, so the remittance is the full COD amount; batch deductions (early COD etc.)
 * are shown on the settlement.
 *   Awaiting collection → Collected → Pending remittance (in a scheduled batch) → Remitted (batch paid, UTR)
 *   Partially remitted (paid less than due) and Disputed (the merchant raised a question) are shown as such.
 */
export const COD_STATE_LABEL = {
  awaiting: "Awaiting collection", collected: "Collected (not yet in a payout)", pending: "Pending remittance", partial: "Partially remitted",
  remitted: "Remitted", disputed: "Disputed", not_collectable: "Not collectable (RTO / cancelled)",
} as const;
export type CodState = keyof typeof COD_STATE_LABEL;

export type CodFilter = { from?: string; to?: string; state?: string; q?: string; storeOnly?: boolean };

export async function codShipments(orgId: string, f: CodFilter = {}) {
  const db = await getDb();
  const S = schema.shipments, O = schema.orders, I = schema.codRemittanceItems, B = schema.codRemittances;
  const conds: SQL[] = [eq(S.orgId, orgId), gt(O.codAmountPaise, 0), eq(S.bookingStatus, "confirmed")];
  if (f.storeOnly) conds.push(eq(O.source, "online_store"));
  if (f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from)) conds.push(gte(S.createdAt, new Date(`${f.from}T00:00:00+05:30`)));
  if (f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to)) conds.push(lte(S.createdAt, new Date(`${f.to}T23:59:59+05:30`)));
  const rows = await db.select({ s: S, o: O, q: schema.quotes, item: I, b: B }).from(S).innerJoin(O, eq(O.id, S.orderId))
    .leftJoin(schema.quotes, eq(schema.quotes.id, S.quoteId)).leftJoin(I, eq(I.shipmentId, S.id)).leftJoin(B, and(eq(B.id, I.remittanceId), ne(B.status, "cancelled")))
    .where(and(...conds)).orderBy(desc(S.createdAt)).limit(5000);
  const ids = rows.map((r) => r.s.id);
  const disputes = ids.length ? await db.select().from(schema.codDisputes).where(and(eq(schema.codDisputes.orgId, orgId), inArray(schema.codDisputes.shipmentId, ids))) : [];
  let out = rows.map(({ s, o, q, item, b }) => {
    const p = q?.priced as PricedQuote | undefined;
    const fee = (p?.lines ?? []).filter((l) => l.code === "cod_fee").reduce((t, l) => t + l.sellPreTax, 0);
    const codFee = Math.round((fee * (10_000 + (p?.gstBps ?? 1800))) / 10_000);
    const due = o.codAmountPaise;
    const delivered = s.status === "delivered";
    const dead = s.status.startsWith("rto") || ["cancelled", "lost"].includes(s.status);
    const remitted = b?.status === "paid" ? item?.codPaise ?? 0 : 0;
    const open = disputes.find((d) => d.shipmentId === s.id && d.status === "open");
    let state: CodState = dead ? "not_collectable" : !delivered ? "awaiting" : b?.status === "paid" ? (remitted < due ? "partial" : "remitted") : b ? "pending" : "collected";
    if (open) state = "disputed";
    return {
      shipmentId: s.id, orderNumber: o.orderNumber, awb: s.awb, courier: s.carrierName, bookedAt: s.createdAt, deliveredAt: s.deliveredAt, status: s.status,
      duePaise: due, collectedPaise: delivered ? due : 0, codFeePaise: codFee, netDuePaise: delivered ? due : 0, remittedPaise: remitted,
      outstandingPaise: delivered ? Math.max(0, due - remitted) : 0, batchId: b?.id ?? null, settledAt: b?.status === "paid" ? b.paidAt : null, utr: b?.status === "paid" ? b.reference : null,
      expectedPayoutAt: b?.status === "scheduled" ? b.expectedPayoutAt : null, state, dispute: open ? { id: open.id, note: open.note, at: open.createdAt } : null,
      lastDispute: disputes.filter((d) => d.shipmentId === s.id).sort((a, c) => +c.createdAt - +a.createdAt)[0] ?? null,
    };
  });
  if (f.state) out = out.filter((r) => r.state === f.state);
  const q = f.q?.trim().toUpperCase();
  if (q) out = out.filter((r) => r.awb?.toUpperCase().includes(q) || r.orderNumber.toUpperCase().includes(q));
  return out;
}

export function codTotals(rows: Awaited<ReturnType<typeof codShipments>>) {
  const sum = (k: "duePaise" | "collectedPaise" | "remittedPaise" | "outstandingPaise" | "codFeePaise") => rows.reduce((t, r) => t + r[k], 0);
  return { due: sum("duePaise"), collected: sum("collectedPaise"), remitted: sum("remittedPaise"), outstanding: sum("outstandingPaise"), fees: sum("codFeePaise"),
    byState: Object.fromEntries(Object.keys(COD_STATE_LABEL).map((k) => [k, rows.filter((r) => r.state === k).length])) as Record<CodState, number> };
}

/** Payout batches with their AWBs (one settlement covers many shipments). */
export async function codSettlements(orgId: string, storeOnly = false) {
  const db = await getDb();
  const batches = await db.select().from(schema.codRemittances).where(and(eq(schema.codRemittances.orgId, orgId), ne(schema.codRemittances.status, "cancelled"))).orderBy(desc(schema.codRemittances.cycleDate)).limit(200);
  if (!batches.length) return [];
  const items = await db.select({ i: schema.codRemittanceItems, awb: schema.shipments.awb, order: schema.orders.orderNumber, source: schema.orders.source })
    .from(schema.codRemittanceItems).innerJoin(schema.shipments, eq(schema.shipments.id, schema.codRemittanceItems.shipmentId)).innerJoin(schema.orders, eq(schema.orders.id, schema.shipments.orderId))
    .where(inArray(schema.codRemittanceItems.remittanceId, batches.map((b) => b.id)));
  return batches.map((b) => {
    const mine = items.filter((x) => x.i.remittanceId === b.id && (!storeOnly || x.source === "online_store"));
    return { id: b.id, status: b.status, cycleDate: b.cycleDate, expectedPayoutAt: b.expectedPayoutAt, paidAt: b.paidAt, utr: b.reference, grossPaise: b.grossPaise, deductionsPaise: b.deductionsPaise,
      deductionNote: b.deductionNote, netPaise: b.netPaise, earlyCod: b.earlyCod, awbs: mine.map((x) => ({ awb: x.awb, order: x.order, codPaise: x.i.codPaise })) };
  }).filter((b) => !storeOnly || b.awbs.length);
}

/**
 * Check a bank / courier / payout file against our records: columns awb, amount (₹), optional utr. Nothing is changed:
 * each row is matched, amount-different, UTR-different, unknown or not remitted yet; our remitted AWBs missing from the
 * file are listed too.
 */
export async function compareCodFile(orgId: string, text: string) {
  const { parseCsv } = await import("@/server/orders/bulk");
  const grid = parseCsv(text.replace(/^﻿/, "")).filter((r) => r.some((c) => c.trim()));
  if (grid.length < 2) throw new StoreError("The file has no rows");
  const head = grid[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const col = (r: string[], k: string) => { const i = head.indexOf(k); return i >= 0 ? (r[i] ?? "").trim() : ""; };
  if (!head.includes("awb") || !head.includes("amount")) throw new StoreError("Columns needed: awb, amount (optional: utr)");
  const ours = await codShipments(orgId);
  const byAwb = new Map(ours.filter((r) => r.awb).map((r) => [r.awb!.toUpperCase(), r]));
  const inFile = new Set<string>();
  const rows = grid.slice(1).map((r, i) => {
    const awb = col(r, "awb").toUpperCase(), raw = col(r, "amount").replace(/[₹,\s]/g, ""), utr = col(r, "utr");
    const amount = /^\d+(\.\d{1,2})?$/.test(raw) ? Math.round(Number(raw) * 100) : null;
    const o = byAwb.get(awb);
    inFile.add(awb);
    let result: "matched" | "amount_differs" | "utr_differs" | "unknown_awb" | "not_remitted" | "bad_row";
    let diff = 0;
    if (!awb || amount === null) result = "bad_row";
    else if (!o) result = "unknown_awb";
    else if (o.remittedPaise === 0) { result = "not_remitted"; diff = amount; }
    else if (amount !== o.remittedPaise) { result = "amount_differs"; diff = amount - o.remittedPaise; }
    else if (utr && o.utr && utr !== o.utr) result = "utr_differs";
    else result = "matched";
    return { row: i + 2, awb, filePaise: amount, oursPaise: o?.remittedPaise ?? null, ourUtr: o?.utr ?? null, fileUtr: utr || null, result, diffPaise: diff, orderNumber: o?.orderNumber ?? null };
  });
  const missing = ours.filter((o) => o.remittedPaise > 0 && o.awb && !inFile.has(o.awb.toUpperCase())).map((o) => ({ awb: o.awb!, orderNumber: o.orderNumber, oursPaise: o.remittedPaise, utr: o.utr }));
  const count = (k: string) => rows.filter((r) => r.result === k).length;
  return { rows, missing, summary: { matched: count("matched"), amountDiffers: count("amount_differs"), utrDiffers: count("utr_differs"), unknown: count("unknown_awb"), notRemitted: count("not_remitted"), bad: count("bad_row"), missing: missing.length } };
}

export async function raiseCodDispute(orgId: string, userId: string, shipmentId: string, note: string) {
  const db = await getDb();
  if (note.trim().length < 5) throw new StoreError("Tell us what is wrong (at least a few words)");
  const [s] = await db.select({ id: schema.shipments.id }).from(schema.shipments).where(and(eq(schema.shipments.id, shipmentId), eq(schema.shipments.orgId, orgId)));
  if (!s) throw new StoreError("Shipment not found");
  const [open] = await db.select({ id: schema.codDisputes.id }).from(schema.codDisputes).where(and(eq(schema.codDisputes.shipmentId, shipmentId), eq(schema.codDisputes.status, "open")));
  if (open) throw new StoreError("A question about this shipment is already open");
  const id = newId("cdd");
  await db.insert(schema.codDisputes).values({ id, orgId, shipmentId, note: note.trim().slice(0, 500), createdBy: userId });
  return { id };
}

/** Staff: answer a COD question. */
export async function resolveCodDispute(staffId: string, id: string, resolution: string) {
  const db = await getDb();
  if (resolution.trim().length < 3) throw new StoreError("Write the answer for the customer");
  const r = await db.update(schema.codDisputes).set({ status: "resolved", resolution: resolution.trim().slice(0, 500), resolvedBy: staffId, resolvedAt: new Date() })
    .where(and(eq(schema.codDisputes.id, id), eq(schema.codDisputes.status, "open"))).returning({ id: schema.codDisputes.id, orgId: schema.codDisputes.orgId });
  if (!r.length) throw new StoreError("Already answered");
  return r[0];
}

export const COD_COLS = ["Order", "AWB", "Courier", "Booked", "Delivered", "COD due", "Collected", "COD fee (in shipping charge)", "Net remittance due", "Remitted", "Settlement date", "UTR", "Outstanding", "Status"];
const day = (x: Date | null) => (x ? new Date(x.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10) : "");
export const codRow = (r: Awaited<ReturnType<typeof codShipments>>[number]) => [r.orderNumber, r.awb ?? "", r.courier, day(r.bookedAt), day(r.deliveredAt),
  ...[r.duePaise, r.collectedPaise, r.codFeePaise, r.netDuePaise, r.remittedPaise].map((p) => p / 100), day(r.settledAt), r.utr ?? "", r.outstandingPaise / 100, COD_STATE_LABEL[r.state]];
