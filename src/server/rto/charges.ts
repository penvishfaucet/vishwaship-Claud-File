import "server-only";
import { and, desc, eq, gte, inArray, like, lte, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/server/db/client";
import { withLedger } from "@/server/ledger/db-store";
import { credit, debit } from "@/server/ledger/wallet";
import type { PricedQuote } from "@/server/pricing/engine";
import { newId } from "@/server/util/ids";

/**
 * RTO charges to the merchant, per shipment.
 *   quoted     RTO started; an estimate from the booking quote (its RTO line, else the forward freight)
 *   awaiting   the parcel is on its way back / back; waiting for the carrier's charge
 *   confirmed  final amount entered from a carrier invoice, settlement file, integration or staff adjustment
 *   adjusted   changed again after confirmation (each change keeps who / when / old → new / why)
 *   reconciled the wallet holds exactly the final charge (net of credits)
 * Only the difference to what already went through the wallet is charged or given back, under an idempotency key,
 * so a repeated confirmation never charges twice. The carrier's own charge to Vishwaship stays internal.
 */
export const RTO_STATE_LABEL: Record<string, string> = { quoted: "Quoted (estimate)", awaiting: "Awaiting carrier charge", confirmed: "Confirmed", adjusted: "Adjusted", reconciled: "Reconciled" };
export const RTO_SOURCES = { carrier_invoice: "Carrier invoice", settlement_file: "Settlement file", integration: "Carrier integration", staff_adjustment: "Staff adjustment" } as const;
type Hist = { at: string; by: string | null; state: string; finalPaise: number | null; creditsPaise: number; source: string | null; reference: string | null; reason: string | null; walletDeltaPaise: number };

export class RtoError extends Error {}
const GST_BPS = 1800;

/** Estimate for one shipment from its booking quote. */
function estimate(s: typeof schema.shipments.$inferSelect, q: { priced: unknown } | null) {
  const p = q?.priced as PricedQuote | undefined;
  const line = (codes: string[]) => (p?.lines ?? []).filter((l) => codes.includes(l.code)).reduce((t, l) => t + l.sellPreTax, 0);
  const withGst = (x: number) => Math.round((x * (10_000 + (p?.gstBps ?? GST_BPS))) / 10_000);
  const rto = line(["rto"]);
  if (rto > 0) return { paise: withGst(rto), basis: "RTO line of the booking quote" };
  const fwd = line(["freight", "fuel"]);
  if (fwd > 0) return { paise: withGst(fwd), basis: "Estimate: same as forward freight" };
  return { paise: s.sellPaise, basis: "Estimate: same as the forward charge" };
}

/** Background: open a record for every shipment that turned RTO (once). */
export async function sweepRtoCharges() {
  const db = await getDb();
  const rows = await db.select({ s: schema.shipments, q: schema.quotes }).from(schema.shipments)
    .leftJoin(schema.quotes, eq(schema.quotes.id, schema.shipments.quoteId))
    .leftJoin(schema.rtoCharges, eq(schema.rtoCharges.shipmentId, schema.shipments.id))
    .where(and(like(schema.shipments.status, "rto%"), sql`${schema.rtoCharges.id} is null`, eq(schema.shipments.bookingStatus, "confirmed"))).limit(300);
  let made = 0;
  for (const { s, q } of rows) {
    const e = estimate(s, q);
    const r = await db.insert(schema.rtoCharges).values({ id: newId("rto"), orgId: s.orgId, shipmentId: s.id, state: s.status === "rto_initiated" ? "quoted" : "awaiting", estimatePaise: e.paise, estimateBasis: e.basis })
      .onConflictDoNothing().returning({ id: schema.rtoCharges.id });
    made += r.length;
  }
  // parcels moving back after the estimate: waiting for the carrier's charge
  await db.update(schema.rtoCharges).set({ state: "awaiting", updatedAt: new Date() })
    .where(and(eq(schema.rtoCharges.state, "quoted"), sql`${schema.rtoCharges.shipmentId} in (select id from shipments where status in ('rto_in_transit', 'rto_delivered'))`));
  return made;
}

export const ConfirmInput = z.object({
  shipmentId: z.string().max(64),
  finalPaise: z.number().int().min(0).max(100_000_000),
  gstPaise: z.number().int().min(0).max(100_000_000).default(0),
  otherPaise: z.number().int().min(0).max(100_000_000).default(0),
  creditsPaise: z.number().int().min(0).max(100_000_000).default(0),
  source: z.enum(Object.keys(RTO_SOURCES) as [keyof typeof RTO_SOURCES, ...Array<keyof typeof RTO_SOURCES>]),
  reference: z.string().trim().max(120).default(""),
  reason: z.string().trim().max(300).default(""),
  chargeWallet: z.boolean().default(true),
});

/** Staff: set the final RTO charge (first time = confirmed, later = adjusted). Optionally settle the difference in the wallet. */
export async function confirmRtoCharge(staffId: string, input: z.input<typeof ConfirmInput>) {
  const a = ConfirmInput.parse(input);
  if (a.gstPaise > a.finalPaise || a.otherPaise > a.finalPaise) throw new RtoError("GST / other charges cannot be more than the final charge");
  if (a.creditsPaise > a.finalPaise) throw new RtoError("Credits cannot be more than the charge");
  if (a.source !== "staff_adjustment" && !a.reference) throw new RtoError("Give the invoice / file / integration reference");
  if (a.source === "staff_adjustment" && a.reason.length < 3) throw new RtoError("Give a reason for the adjustment");
  const db = await getDb();
  const [s] = await db.select().from(schema.shipments).where(eq(schema.shipments.id, a.shipmentId));
  if (!s) throw new RtoError("Shipment not found");
  if (!s.status.startsWith("rto")) throw new RtoError("This shipment is not an RTO");
  let [rc] = await db.select().from(schema.rtoCharges).where(eq(schema.rtoCharges.shipmentId, s.id));
  if (!rc) { await sweepRtoCharges(); [rc] = await db.select().from(schema.rtoCharges).where(eq(schema.rtoCharges.shipmentId, s.id)); }
  if (!rc) throw new RtoError("Shipment not found");
  const history = (rc.history as Hist[]) ?? [];
  const net = a.finalPaise - a.creditsPaise;
  let delta = 0;
  if (a.chargeWallet) {
    delta = net - rc.chargedPaise;
    const [w] = await db.select({ id: schema.wallets.id }).from(schema.wallets).where(eq(schema.wallets.orgId, s.orgId));
    if (!w) throw new RtoError("The customer has no wallet");
    const key = `rto:${rc.id}:${history.length}`;
    if (delta > 0) await withLedger((st) => debit(st, { walletId: w.id, amount: delta, kind: "rto_charge", idempotencyKey: key, refType: "shipment", refId: s.id, memo: `RTO charge AWB ${s.awb ?? ""}`.trim(), allowNegative: true }));
    if (delta < 0) await withLedger((st) => credit(st, { walletId: w.id, amount: -delta, kind: "rto_credit", idempotencyKey: key, refType: "shipment", refId: s.id, memo: `RTO charge reduced AWB ${s.awb ?? ""}`.trim() }));
  }
  const charged = a.chargeWallet ? net : rc.chargedPaise;
  const state = charged === net && a.chargeWallet ? "reconciled" : rc.finalPaise === null ? "confirmed" : "adjusted";
  const h: Hist = { at: new Date().toISOString(), by: staffId, state, finalPaise: a.finalPaise, creditsPaise: a.creditsPaise, source: a.source, reference: a.reference || null, reason: a.reason || null, walletDeltaPaise: delta };
  // the history length doubles as a version: a parallel confirmation of the same version loses
  const upd = await db.update(schema.rtoCharges).set({ state, finalPaise: a.finalPaise, gstPaise: a.gstPaise, otherPaise: a.otherPaise, creditsPaise: a.creditsPaise, source: a.source,
    reference: a.reference || null, chargedPaise: charged, history: [...history, h], updatedAt: new Date() })
    .where(and(eq(schema.rtoCharges.id, rc.id), sql`jsonb_array_length(${schema.rtoCharges.history}) = ${history.length}`)).returning({ id: schema.rtoCharges.id });
  if (!upd.length) throw new RtoError("Someone changed this charge at the same time. Refresh and try again.");
  return { state, walletDeltaPaise: delta, old: { finalPaise: rc.finalPaise, chargedPaise: rc.chargedPaise, state: rc.state } };
}

/**
 * Settlement / invoice file: awb, rto_charge (₹ incl. GST), gst, other, credit, reference. Preview lists each row's
 * problems; apply confirms the good rows (source "settlement_file") and settles them in the wallet when asked.
 */
export async function importRtoFile(staffId: string, text: string, opts: { apply: boolean; chargeWallet: boolean }) {
  const { parseCsv } = await import("@/server/orders/bulk");
  const grid = parseCsv(text.replace(/^﻿/, "")).filter((r) => r.some((c) => c.trim()));
  if (grid.length < 2) throw new RtoError("The file has no rows");
  const head = grid[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  if (!head.includes("awb") || !head.includes("rto_charge")) throw new RtoError("Columns needed: awb, rto_charge (optional: gst, other, credit, reference)");
  const col = (r: string[], k: string) => { const i = head.indexOf(k); return i >= 0 ? (r[i] ?? "").trim() : ""; };
  const money = (v: string) => (v === "" ? 0 : /^\d+(\.\d{1,2})?$/.test(v.replace(/[₹,\s]/g, "")) ? Math.round(Number(v.replace(/[₹,\s]/g, "")) * 100) : NaN);
  const db = await getDb();
  const awbs = grid.slice(1).map((r) => col(r, "awb")).filter(Boolean);
  const ships = awbs.length ? await db.select().from(schema.shipments).where(inArray(schema.shipments.awb, awbs)) : [];
  const seen = new Set<string>();
  const rows = grid.slice(1).map((r, i) => {
    const awb = col(r, "awb"), errors: string[] = [];
    const s = ships.filter((x) => x.awb === awb);
    const v = { final: money(col(r, "rto_charge")), gst: money(col(r, "gst")), other: money(col(r, "other")), credit: money(col(r, "credit")) };
    if (!awb) errors.push("AWB is empty");
    else if (!s.length) errors.push("AWB not found");
    else if (s.length > 1) errors.push("AWB matches several shipments");
    else if (!s[0].status.startsWith("rto")) errors.push("Not an RTO shipment");
    if (seen.has(awb)) errors.push("Same AWB twice in the file"); seen.add(awb);
    if (Object.values(v).some((x) => Number.isNaN(x))) errors.push("Amounts must be like 125.50");
    if (!errors.length && v.final <= 0) errors.push("rto_charge is empty");
    return { row: i + 2, awb, shipmentId: s.length === 1 ? s[0].id : null, ...v, reference: col(r, "reference"), errors };
  });
  if (!opts.apply) return { rows, valid: rows.filter((r) => !r.errors.length).length };
  let done = 0; const failed: string[] = [];
  for (const r of rows) {
    if (r.errors.length || !r.shipmentId) continue;
    try {
      await confirmRtoCharge(staffId, { shipmentId: r.shipmentId, finalPaise: r.final, gstPaise: r.gst, otherPaise: r.other, creditsPaise: r.credit, source: "settlement_file", reference: r.reference || `file row ${r.row}`, chargeWallet: opts.chargeWallet });
      done++;
    } catch (e) { failed.push(`${r.awb}: ${(e as Error).message}`); }
  }
  return { rows, valid: done, failed };
}

export type RtoFilter = { from?: string; to?: string; courier?: string; awb?: string; state?: string; storeOnly?: boolean };

/** Order-wise RTO report (merchant: their own; staff: any org, optionally with the carrier's internal cost). */
export async function rtoReport(orgId: string | null, f: RtoFilter, opts: { internal?: boolean } = {}) {
  await sweepRtoCharges();
  const db = await getDb();
  const S = schema.shipments, O = schema.orders;
  const conds: SQL[] = [like(S.status, "rto%"), eq(S.bookingStatus, "confirmed")];
  if (orgId) conds.push(eq(S.orgId, orgId));
  if (f.storeOnly) conds.push(eq(O.source, "online_store"));
  if (f.courier) conds.push(eq(S.carrierName, f.courier));
  if (f.awb) conds.push(or(eq(S.awb, f.awb.trim()), eq(O.orderNumber, f.awb.trim()))!);
  if (f.from && /^\d{4}-\d{2}-\d{2}$/.test(f.from)) conds.push(gte(S.createdAt, new Date(`${f.from}T00:00:00+05:30`)));
  if (f.to && /^\d{4}-\d{2}-\d{2}$/.test(f.to)) conds.push(lte(S.createdAt, new Date(`${f.to}T23:59:59+05:30`)));
  const rows = await db.select({ s: S, o: O, q: schema.quotes, rc: schema.rtoCharges, org: schema.orgs.businessName }).from(S)
    .innerJoin(O, eq(O.id, S.orderId)).innerJoin(schema.orgs, eq(schema.orgs.id, S.orgId))
    .leftJoin(schema.quotes, eq(schema.quotes.id, S.quoteId)).leftJoin(schema.rtoCharges, eq(schema.rtoCharges.shipmentId, S.id))
    .where(and(...conds)).orderBy(desc(S.createdAt)).limit(3000);
  const ids = rows.map((r) => r.s.id);
  const ev = ids.length ? await db.select({ id: schema.shipmentEvents.shipmentId, status: schema.shipmentEvents.status, at: schema.shipmentEvents.occurredAt, remark: schema.shipmentEvents.remark })
    .from(schema.shipmentEvents).where(inArray(schema.shipmentEvents.shipmentId, ids)).orderBy(schema.shipmentEvents.occurredAt) : [];
  const out = rows.map(({ s, o, q, rc, org }) => {
    const p = q?.priced as PricedQuote | undefined;
    const line = (codes: string[]) => (p?.lines ?? []).filter((l) => codes.includes(l.code)).reduce((t, l) => t + l.sellPreTax, 0);
    const mine = ev.filter((e) => e.id === s.id);
    const first = (st: string) => mine.find((e) => e.status === st)?.at ?? null;
    const reason = [...mine].reverse().find((e) => (e.status === "ndr" || e.status.startsWith("rto")) && e.remark)?.remark ?? null;
    const est = !rc || rc.finalPaise === null;
    return {
      shipmentId: s.id, orgId: s.orgId, customer: org, orderNumber: o.orderNumber, awb: s.awb, courier: s.carrierName, pickupDate: s.pickupDate, status: s.status, reason,
      rtoInitiatedAt: first("rto_initiated"), rtoDeliveredAt: first("rto_delivered"),
      forwardFreightPaise: line(["freight", "fuel"]), forwardSurchargesPaise: line(["fov", "oda", "handling", "docket", "other", "cod_fee"]), forwardGstPaise: p?.gst ?? 0, forwardTotalPaise: s.sellPaise,
      rtoChargePaise: est ? rc?.estimatePaise ?? 0 : rc!.finalPaise!, estimated: est, estimateBasis: rc?.estimateBasis ?? null,
      otherReversePaise: rc?.otherPaise ?? 0, rtoGstPaise: rc?.gstPaise ?? null, creditsPaise: rc?.creditsPaise ?? 0,
      finalChargePaise: est ? null : rc!.finalPaise! - rc!.creditsPaise, chargedPaise: rc?.chargedPaise ?? 0,
      state: rc?.state ?? "awaiting", source: rc?.source ?? null, reference: rc?.reference ?? null, history: (rc?.history as Hist[] | undefined) ?? [],
      ...(opts.internal ? { carrierChargePaise: s.carrierChargePaise, quotedCostPaise: s.costPaise } : {}),
    };
  });
  return f.state ? out.filter((r) => r.state === f.state) : out;
}

export const RTO_COLS = ["Order", "AWB", "Courier", "Pickup date", "RTO reason", "RTO initiated", "RTO delivered", "Forward freight", "Forward surcharges", "Forward GST", "RTO freight", "Other reverse charges", "RTO GST", "Credits", "Final charge", "Charged to wallet", "Status", "Source", "Reference"];
const d = (x: Date | null) => (x ? new Date(x.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10) : "");
const r2 = (p: number | null) => (p === null ? "" : Math.round(p) / 100);
export const rtoRow = (r: Awaited<ReturnType<typeof rtoReport>>[number]) => [r.orderNumber, r.awb ?? "", r.courier, d(r.pickupDate), r.reason ?? "", d(r.rtoInitiatedAt), d(r.rtoDeliveredAt),
  r2(r.forwardFreightPaise), r2(r.forwardSurchargesPaise), r2(r.forwardGstPaise), r.estimated ? `${r2(r.rtoChargePaise)} (estimate)` : r2(r.rtoChargePaise), r2(r.otherReversePaise), r2(r.rtoGstPaise),
  r2(r.creditsPaise), r.finalChargePaise === null ? "pending" : r2(r.finalChargePaise), r2(r.chargedPaise), RTO_STATE_LABEL[r.state] ?? r.state, r.source ? RTO_SOURCES[r.source as keyof typeof RTO_SOURCES] ?? r.source : "", r.reference ?? ""];
