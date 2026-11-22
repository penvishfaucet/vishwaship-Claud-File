import "server-only";
import { and, eq, inArray, lte, or } from "drizzle-orm";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db/client";
import { parseCsv } from "@/server/orders/bulk";
import { newId } from "@/server/util/ids";
import { computeWeightCharge, type PricedSnapshot, type WeightCalc } from "./calc";

/** Days the client has to dispute before the charge is debited automatically. */
export const DISPUTE_WINDOW_DAYS = 7;
export const MAX_IMPORT_ROWS = 2000;

export type RaiseOutcome =
  | { status: "created"; disputeId: string; chargePaise: number; calc: WeightCalc }
  | { status: "exists" | "no_extra" | "not_found" | "no_quote"; message: string };

type Shipment = typeof schema.shipments.$inferSelect;

async function evaluate(sh: Shipment, carrierGrams: number, courierExtraPaise: number | null | undefined) {
  const db = await getDb();
  const [q] = await db.select({ priced: schema.quotes.priced }).from(schema.quotes).where(eq(schema.quotes.id, sh.quoteId));
  if (!q) return { status: "no_quote" as const, message: "Booking quote not found — cannot re-rate" };
  const calc = computeWeightCharge({ priced: q.priced as PricedSnapshot, bookedGrams: sh.chargeableWeightGrams, revisedGrams: carrierGrams, courierExtraPreTax: courierExtraPaise });
  if (!calc) return { status: "no_extra" as const, message: `Courier weight ${(carrierGrams / 1000).toFixed(2)} kg is not above the booked ${(sh.chargeableWeightGrams / 1000).toFixed(2)} kg` };
  const [dup] = await db.select({ id: schema.weightDisputes.id, status: schema.weightDisputes.status }).from(schema.weightDisputes).where(eq(schema.weightDisputes.shipmentId, sh.id)).limit(1);
  if (dup) return { status: "exists" as const, message: `A weight discrepancy already exists for this shipment (${dup.status})` };
  return { status: "ok" as const, calc };
}

/**
 * The courier reported a charged weight for a shipment. Always stores it on the shipment; when it is above the
 * booked chargeable weight (and no discrepancy exists yet) a weight discrepancy is raised for the client with a
 * 7-day dispute window. Nothing is debited here — chargeDueDisputes() debits once the window closes undisputed.
 */
export async function raiseWeightDiscrepancy(a: { shipmentId: string; carrierGrams: number; courierExtraPaise?: number | null; source: "csv" | "api" | "manual"; evidence?: Array<Record<string, unknown>>; actorUserId?: string | null }): Promise<RaiseOutcome> {
  const db = await getDb();
  const grams = Math.round(a.carrierGrams);
  const [sh] = await db.select().from(schema.shipments).where(eq(schema.shipments.id, a.shipmentId));
  if (!sh) return { status: "not_found", message: "Shipment not found" };
  if (!(grams > 0)) return { status: "no_extra", message: "No courier weight" };
  if (sh.carrierWeightGrams !== grams) await db.update(schema.shipments).set({ carrierWeightGrams: grams }).where(eq(schema.shipments.id, sh.id));
  const r = await evaluate(sh, grams, a.courierExtraPaise);
  if (r.status !== "ok") return r;
  const id = newId("wd");
  const label = a.source === "csv" ? "Courier weight report" : a.source === "api" ? "Courier re-weigh (tracking)" : "Courier re-weigh";
  await db.insert(schema.weightDisputes).values({
    id, orgId: sh.orgId, shipmentId: sh.id, declaredGrams: sh.chargeableWeightGrams, carrierGrams: grams, revisedChargeableGrams: grams,
    bookedChargeableGrams: sh.chargeableWeightGrams, chargePaise: r.calc.chargePaise, courierExtraPaise: a.courierExtraPaise ?? null, calc: r.calc,
    evidence: a.evidence?.length ? a.evidence : [{ kind: "courier", label: `${label}: ${(grams / 1000).toFixed(2)} kg` }],
    deadlineAt: new Date(Date.now() + DISPUTE_WINDOW_DAYS * 86400_000), source: a.source,
  });
  await db.insert(schema.inAppAlerts).values({ id: newId("al"), orgId: sh.orgId, kind: "wallet", title: `Weight discrepancy${sh.awb ? ` on ${sh.awb}` : ""}: courier weight ${(grams / 1000).toFixed(2)} kg vs booked ${(sh.chargeableWeightGrams / 1000).toFixed(2)} kg — dispute within ${DISPUTE_WINDOW_DAYS} days`, href: "/portal/tools/weight-discrepancy/" });
  await audit({ actorUserId: a.actorUserId ?? undefined, actorKind: a.actorUserId ? "staff" : "system", orgId: sh.orgId, action: "weight_dispute.raised", targetType: "weight_dispute", targetId: id, details: { shipmentId: sh.id, source: a.source, bookedGrams: sh.chargeableWeightGrams, carrierGrams: grams, chargePaise: r.calc.chargePaise, courierExtraPaise: a.courierExtraPaise ?? null } });
  return { status: "created", disputeId: id, chargePaise: r.calc.chargePaise, calc: r.calc };
}

/** Undisputed discrepancies past their deadline: debit the wallet (once — ledger key wd-charge:<id>). */
export async function chargeDueDisputes(now = new Date(), limit = 100) {
  const db = await getDb();
  const due = await db.select({ id: schema.weightDisputes.id }).from(schema.weightDisputes)
    .where(and(eq(schema.weightDisputes.status, "open"), lte(schema.weightDisputes.deadlineAt, now))).limit(limit);
  const { resolveWeightDispute } = await import("@/server/admin/disputes");
  let charged = 0;
  for (const d of due) {
    try { if ((await resolveWeightDispute(d.id, "charge", null)).ok) charged++; }
    catch (e) { console.error("[weight]", d.id, (e as Error).message); }
  }
  return { charged };
}

// ---------- courier report import (CSV) ----------

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const AWB_H = [/^(awb|waybill|lr|lrn|lr ?n(o|um|umber)?|awb ?n(o|um|umber)?|docket( n(o|um|umber))?|tracking( id| n(o|umber))?|wbn)$/];
const WT_H = [/charged( weight| wt)?/, /chargeable( weight| wt)/, /billed( weight| wt)/, /revised( weight| wt)/, /courier( weight| wt)/, /applied weight/, /^weight\b/];
const EXTRA_H = [/(extra|excess|additional|difference|discrepancy|differential)( freight)?( charge| amount| amt)?/];

function findCol(header: string[], pats: RegExp[], skip: number[] = []) {
  for (const p of pats) {
    const i = header.findIndex((h, j) => !skip.includes(j) && p.test(h));
    if (i >= 0) return i;
  }
  return -1;
}

export interface ImportRow {
  line: number; ref: string; status: "ok" | "not_found" | "no_extra" | "exists" | "no_quote" | "invalid";
  message?: string; shipmentId?: string; orgName?: string; awb?: string | null; carrierName?: string;
  bookedGrams?: number; carrierGrams?: number; courierExtraPaise?: number | null; chargePaise?: number;
}

/** Parse a courier weight report: AWB/LR, charged weight (kg, or grams when the header says g / gm / grams), optional extra amount (₹, pre-tax). */
export function parseWeightReport(text: string): { rows: Array<{ line: number; ref: string; grams: number | null; extraPaise: number | null }>; error?: string } {
  const all = parseCsv(text);
  if (all.length < 2) return { rows: [], error: "The file has no data rows" };
  const header = all[0].map(norm);
  const ai = findCol(header, AWB_H);
  const wi = findCol(header, WT_H, [ai]);
  const xi = findCol(header, EXTRA_H, [ai, wi]);
  if (ai < 0 || wi < 0) return { rows: [], error: "Need an AWB / LR column and a charged-weight column (e.g. \"AWB\", \"Charged Weight (kg)\")" };
  const grams = /\b(g|gm|gms|gram|grams)\b/.test(header[wi]) && !/\bkg\b/.test(header[wi]);
  const num = (v: string | undefined) => { const n = Number(String(v ?? "").replace(/[₹,\s]|rs\.?|kgs?|gms?/gi, "")); return Number.isFinite(n) ? n : NaN; };
  const rows = all.slice(1, MAX_IMPORT_ROWS + 1).map((r, i) => {
    const w = num(r[wi]), x = xi >= 0 ? num(r[xi]) : NaN;
    return { line: i + 2, ref: String(r[ai] ?? "").trim(), grams: w > 0 ? Math.round(grams ? w : w * 1000) : null, extraPaise: x > 0 ? Math.round(x * 100) : null };
  });
  return { rows };
}

/** Preview (commit = false) or apply (commit = true) a courier weight report. Preview writes nothing. */
export async function importWeightReport(text: string, opts: { commit: boolean; actorUserId: string }): Promise<{ rows: ImportRow[]; error?: string; created: number; totalChargePaise: number }> {
  const parsed = parseWeightReport(text);
  if (parsed.error) return { rows: [], error: parsed.error, created: 0, totalChargePaise: 0 };
  const db = await getDb();
  const refs = [...new Set(parsed.rows.map((r) => r.ref).filter(Boolean))];
  const ships = refs.length ? await db.select({ s: schema.shipments, org: schema.orgs.businessName }).from(schema.shipments).innerJoin(schema.orgs, eq(schema.orgs.id, schema.shipments.orgId))
    .where(or(inArray(schema.shipments.awb, refs), inArray(schema.shipments.lrNumber, refs))) : [];
  const byRef = new Map<string, (typeof ships)[number]>();
  for (const x of ships) { if (x.s.awb) byRef.set(x.s.awb, x); if (x.s.lrNumber) byRef.set(x.s.lrNumber, x); }
  const out: ImportRow[] = [];
  const seen = new Set<string>();
  let created = 0, total = 0;
  for (const r of parsed.rows) {
    const base: ImportRow = { line: r.line, ref: r.ref, status: "invalid" };
    if (!r.ref || !r.grams) { out.push({ ...base, message: !r.ref ? "No AWB / LR" : "No charged weight" }); continue; }
    const m = byRef.get(r.ref);
    if (!m) { out.push({ ...base, status: "not_found", message: "No Vishwaship shipment with this AWB / LR" }); continue; }
    const info = { shipmentId: m.s.id, orgName: m.org, awb: m.s.awb, carrierName: m.s.carrierName, bookedGrams: m.s.chargeableWeightGrams, carrierGrams: r.grams, courierExtraPaise: r.extraPaise };
    if (seen.has(m.s.id)) { out.push({ ...base, ...info, status: "exists", message: "Listed twice in this file" }); continue; }
    seen.add(m.s.id);
    if (opts.commit) {
      const res = await raiseWeightDiscrepancy({ shipmentId: m.s.id, carrierGrams: r.grams, courierExtraPaise: r.extraPaise, source: "csv", actorUserId: opts.actorUserId });
      if (res.status === "created") { created++; total += res.chargePaise; out.push({ ...base, ...info, status: "ok", chargePaise: res.chargePaise }); }
      else out.push({ ...base, ...info, status: res.status, message: res.message });
    } else {
      const res = await evaluate(m.s, r.grams, r.extraPaise);
      if (res.status === "ok") { total += res.calc.chargePaise; out.push({ ...base, ...info, status: "ok", chargePaise: res.calc.chargePaise }); }
      else out.push({ ...base, ...info, status: res.status, message: res.message });
    }
  }
  if (opts.commit) await audit({ actorUserId: opts.actorUserId, actorKind: "staff", action: "weight_dispute.import", targetType: "weight_dispute", targetId: "import", details: { rows: parsed.rows.length, created, totalChargePaise: total } });
  return { rows: out, created, totalChargePaise: total };
}
