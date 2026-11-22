import "server-only";
import { and, eq, inArray, lte, or } from "drizzle-orm";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db/client";
import { parseCsv } from "@/server/orders/bulk";
import { formatINR, pctOf } from "@/lib/money";
import { newId } from "@/server/util/ids";
import { computeWeightCharge, type PricedSnapshot, type WeightCalc } from "./calc";

const APP_URL = () => (process.env.APP_URL ?? "https://vishwaship.in").replace(/\/+$/, "");

/** Days the client has to dispute before the charge is debited automatically. */
export const DISPUTE_WINDOW_DAYS = 7;
export const MAX_IMPORT_ROWS = 2000;

export type RaiseOutcome =
  | { status: "created"; disputeId: string; chargePaise: number; receiverExtraPaise: number; calc: WeightCalc }
  | { status: "exists" | "no_extra" | "not_found" | "no_quote"; message: string };

type Shipment = typeof schema.shipments.$inferSelect;

/**
 * What the extra weight costs whom.
 *  - Sender pays (prepaid / COD): the client's wallet is charged the whole difference (calc.chargePaise).
 *  - FoD (freight on delivery): NEVER a wallet charge (owner rule 2026-11-22). The receiver pays the higher freight at
 *    delivery — the courier's own freight (+GST), or the whole difference when FoD is at the Vishwaship rate. The client
 *    is only informed (portal alert + email); the courier informs the receiver.
 */
export function splitForPayer(calc: WeightCalc, freightPayer: string, basis: string | undefined) {
  if (freightPayer !== "receiver") return { walletCharge: calc.chargePaise, receiverExtra: 0 };
  if (basis === "vishwaship_rate") return { walletCharge: 0, receiverExtra: calc.chargePaise };
  const recv = (x: WeightCalc["before"]) => Math.min(x.total, x.costPreTax + pctOf(x.costPreTax, calc.gstBps));
  return { walletCharge: 0, receiverExtra: recv(calc.after) - recv(calc.before) };
}

async function evaluate(sh: Shipment, carrierGrams: number, courierExtraPaise: number | null | undefined) {
  const db = await getDb();
  const [q] = await db.select({ priced: schema.quotes.priced }).from(schema.quotes).where(eq(schema.quotes.id, sh.quoteId));
  if (!q) return { status: "no_quote" as const, message: "Booking quote not found — cannot re-rate" };
  const priced = q.priced as PricedSnapshot & { payer?: { basis?: string } };
  const calc = computeWeightCharge({ priced, bookedGrams: sh.chargeableWeightGrams, revisedGrams: carrierGrams, courierExtraPreTax: courierExtraPaise });
  if (!calc) return { status: "no_extra" as const, message: `Courier weight ${(carrierGrams / 1000).toFixed(2)} kg is not above the booked ${(sh.chargeableWeightGrams / 1000).toFixed(2)} kg` };
  const [dup] = await db.select({ id: schema.weightDisputes.id, status: schema.weightDisputes.status }).from(schema.weightDisputes).where(eq(schema.weightDisputes.shipmentId, sh.id)).limit(1);
  if (dup) return { status: "exists" as const, message: `A weight discrepancy already exists for this shipment (${dup.status})` };
  return { status: "ok" as const, calc, ...splitForPayer(calc, sh.freightPayer, priced.payer?.basis) };
}

/**
 * The courier reported a charged weight for a shipment. Always stores it on the shipment; when it is above the
 * booked chargeable weight (or the courier states an extra amount) and no discrepancy exists yet, a weight
 * discrepancy is raised: the client is told in the portal and by email, with a 7-day dispute window. Nothing is
 * debited here — chargeDueDisputes() debits once the window closes undisputed. FoD: the receiver's freight is updated.
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
  const fod = sh.freightPayer === "receiver";
  const label = a.source === "csv" ? "Courier weight report" : a.source === "api" ? "Courier re-weigh (tracking)" : "Courier re-weigh";
  const deadline = new Date(Date.now() + DISPUTE_WINDOW_DAYS * 86400_000);
  const recvAfter = sh.receiverFreightPaise + r.receiverExtra;
  await db.insert(schema.weightDisputes).values({
    id, orgId: sh.orgId, shipmentId: sh.id, declaredGrams: sh.chargeableWeightGrams, carrierGrams: grams, revisedChargeableGrams: grams,
    bookedChargeableGrams: sh.chargeableWeightGrams, chargePaise: r.walletCharge, courierExtraPaise: a.courierExtraPaise ?? null,
    calc: { ...r.calc, walletChargePaise: r.walletCharge, ...(fod ? { fod: true, receiverExtraPaise: r.receiverExtra, receiverBeforePaise: sh.receiverFreightPaise, receiverAfterPaise: recvAfter } : {}) },
    evidence: a.evidence?.length ? a.evidence : [{ kind: "courier", label: `${label}: ${(grams / 1000).toFixed(2)} kg` }],
    deadlineAt: deadline, source: a.source,
  });
  if (fod && r.receiverExtra > 0) await db.update(schema.shipments).set({ receiverFreightPaise: recvAfter }).where(eq(schema.shipments.id, sh.id));

  const kgs = (g: number) => `${(g / 1000).toFixed(2)} kg`;
  const due = deadline.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });
  const receiverLine = fod && r.receiverExtra > 0 ? `Freight to be collected from the receiver at delivery: ${formatINR(sh.receiverFreightPaise)} → ${formatINR(recvAfter)} (incl. GST).` : "";
  const walletLine = r.walletCharge > 0
    ? `Extra shipping charge for you: ${formatINR(r.walletCharge)} (incl. GST). It will be debited from your Vishwaship wallet on ${due} unless you raise a dispute before then.

If you believe the courier weight is wrong, raise a dispute with photos of the packed box (on a weighing scale, with dimensions) before ${due} using the button below.`
    : fod ? `This is a freight-on-delivery (FoD) shipment: nothing is charged to your Vishwaship wallet. The receiver pays the updated freight at delivery, and the courier informs the receiver. This email is for your information, so you can let your customer know.\n\nIf you believe the courier weight is wrong, raise a dispute with photos of the packed box (on a weighing scale, with dimensions) before ${due} using the button below, and we will take it up with the courier.` : "No extra amount will be debited from your wallet.";
  await db.insert(schema.inAppAlerts).values({ id: newId("al"), orgId: sh.orgId, kind: "wallet", href: "/portal/tools/weight-discrepancy/",
    title: `Weight increased${sh.awb ? ` on ${sh.awb}` : ""}: ${kgs(sh.chargeableWeightGrams)} → ${kgs(grams)}.${fod && r.receiverExtra > 0 ? ` Receiver pays ${formatINR(recvAfter)} at delivery.` : ""}${r.walletCharge > 0 ? ` ${formatINR(r.walletCharge)} to be debited on ${due} unless disputed.` : ""}` });
  try {
    const { clientEmail } = await import("@/server/client-email");
    const to = await clientEmail(sh.orgId);
    if (to) {
      const [o] = await db.select({ orderNumber: schema.orders.orderNumber }).from(schema.orders).where(eq(schema.orders.id, sh.orderId));
      const [org] = await db.select({ name: schema.orgs.businessName }).from(schema.orgs).where(eq(schema.orgs.id, sh.orgId));
      const { sendEmail } = await import("@/server/email/service");
      await sendEmail({ event: "weight_discrepancy", to, toKind: "client", orgId: sh.orgId, shipmentId: sh.id, dedupeKey: `weight_discrepancy:${id}`,
        vars: { customer_name: org?.name ?? "", order_id: o?.orderNumber ?? "", awb_number: sh.awb ?? "", courier_name: sh.carrierName, booked_weight: kgs(sh.chargeableWeightGrams), courier_weight: kgs(grams),
          charge_details: [receiverLine, walletLine].filter(Boolean).join("\n\n"), dispute_by: due, tracking_link: `${APP_URL()}/portal/tools/weight-discrepancy/` } });
    }
  } catch (e) { console.error("[weight email]", (e as Error).message); }
  await audit({ actorUserId: a.actorUserId ?? undefined, actorKind: a.actorUserId ? "staff" : "system", orgId: sh.orgId, action: "weight_dispute.raised", targetType: "weight_dispute", targetId: id, details: { shipmentId: sh.id, source: a.source, bookedGrams: sh.chargeableWeightGrams, carrierGrams: grams, walletChargePaise: r.walletCharge, receiverExtraPaise: r.receiverExtra, courierExtraPaise: a.courierExtraPaise ?? null } });
  return { status: "created", disputeId: id, chargePaise: r.walletCharge, receiverExtraPaise: r.receiverExtra, calc: r.calc };
}

/** Undisputed discrepancies past their deadline: debit the wallet (once — ledger key wd-charge:<id>). */
export async function chargeDueDisputes(now = new Date(), limit = 100) {
  const db = await getDb();
  const due = await db.select({ id: schema.weightDisputes.id, chargePaise: schema.weightDisputes.chargePaise }).from(schema.weightDisputes)
    .where(and(eq(schema.weightDisputes.status, "open"), lte(schema.weightDisputes.deadlineAt, now))).limit(limit);
  const { resolveWeightDispute } = await import("@/server/admin/disputes");
  let charged = 0;
  for (const d of due) {
    // FoD rows (nothing to charge) are simply closed: the courier weight stands, the receiver pays at delivery.
    try { if ((await resolveWeightDispute(d.id, "charge", null)).ok && d.chargePaise > 0) charged++; }
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
  bookedGrams?: number; carrierGrams?: number; courierExtraPaise?: number | null; chargePaise?: number; receiverExtraPaise?: number; note?: string;
}

/** Parse a courier weight report: AWB/LR, charged weight (kg, or grams when the header says g / gm / grams), optional extra amount (₹, pre-tax). */
type ReportRow = { line: number; ref: string; grams: number | null; extraPaise: number | null; note?: string };
const inr = (v: string) => Math.round(Number(v.replace(/,/g, "")) * 100);

/**
 * Courier weight-discrepancy e-mails (one or several pasted together), e.g. Delhivery B2B:
 * "LR 323198958 ... initial charged weight of 30 kg ... the charged weight of this LR is 41 kg ... increased from INR 739.19
 * to INR 885.74 ... Pre-tax Freight Charges 750.63". Extra (pre-tax) = new pre-tax − old total ÷ 1.18; without the pre-tax
 * line, (new − old) ÷ 1.18. Amounts in these mails include GST at 18%.
 */
export function parseCourierMails(text: string): ReportRow[] {
  const t = text.replace(/\u00a0/g, " ");
  const starts = [...t.matchAll(/\bLR\s*(?:no\.?|number)?\s*[:#]?\s*(\d{6,})/gi)];
  const rows: ReportRow[] = [];
  let prev = "";
  starts.forEach((m, i) => {
    if (m[1] === prev) return;
    prev = m[1];
    const next = starts.slice(i + 1).find((x) => x[1] !== m[1]);
    const seg = t.slice(m.index, next?.index ?? t.length);
    const fin = seg.match(/charged weight of this LR is\s*([\d.]+)\s*kg/i) ?? seg.match(/(?:revised|final|new|actual) charged weight[^\d]{0,40}([\d.]+)\s*kg/i);
    if (!fin) return;
    const init = seg.match(/initial charged weight of\s*([\d.]+)\s*kg/i);
    const amt = seg.match(/increased from\s*(?:INR|Rs\.?|₹)\s*([\d,]+(?:\.\d+)?)\s*to\s*(?:INR|Rs\.?|₹)\s*([\d,]+(?:\.\d+)?)/i);
    const pre = seg.match(/Pre-?\s?tax Freight Charges?\s*(?:₹|Rs\.?|INR)?\s*([\d,]+(?:\.\d+)?)/i);
    let extra: number | null = null;
    if (amt) {
      const oldPre = Math.round((inr(amt[1]) * 100) / 118);
      extra = pre ? inr(pre[1]) - oldPre : Math.round(((inr(amt[2]) - inr(amt[1])) * 100) / 118);
      if (!(extra > 0)) extra = null;
    }
    rows.push({ line: rows.length + 1, ref: m[1], grams: Math.round(Number(fin[1]) * 1000), extraPaise: extra,
      note: `Courier re-weigh: ${init ? `${init[1]} kg → ` : ""}${fin[1]} kg${amt ? ` · courier freight ₹${amt[1]} → ₹${amt[2]} (incl. GST)` : ""}` });
  });
  return rows;
}

export function parseWeightReport(text: string): { rows: ReportRow[]; error?: string } {
  if (/charged weight of this LR|initial charged weight/i.test(text)) {
    const rows = parseCourierMails(text);
    return rows.length ? { rows } : { rows: [], error: "Could not read the LR and charged weight from this e-mail text" };
  }
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
export async function importWeightReport(text: string, opts: { commit: boolean; actorUserId: string | null }): Promise<{ rows: ImportRow[]; error?: string; created: number; totalChargePaise: number }> {
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
    const info = { note: r.note, shipmentId: m.s.id, orgName: m.org, awb: m.s.awb, carrierName: m.s.carrierName, bookedGrams: m.s.chargeableWeightGrams, carrierGrams: r.grams, courierExtraPaise: r.extraPaise };
    if (seen.has(m.s.id)) { out.push({ ...base, ...info, status: "exists", message: "Listed twice in this file" }); continue; }
    seen.add(m.s.id);
    if (opts.commit) {
      const res = await raiseWeightDiscrepancy({ shipmentId: m.s.id, carrierGrams: r.grams, courierExtraPaise: r.extraPaise, source: "csv", actorUserId: opts.actorUserId, ...(r.note ? { evidence: [{ kind: "courier", label: r.note }] } : {}) });
      if (res.status === "created") { created++; total += res.chargePaise; out.push({ ...base, ...info, status: "ok", chargePaise: res.chargePaise, receiverExtraPaise: res.receiverExtraPaise || undefined }); }
      else out.push({ ...base, ...info, status: res.status, message: res.message });
    } else {
      const res = await evaluate(m.s, r.grams, r.extraPaise);
      if (res.status === "ok") { total += res.walletCharge; out.push({ ...base, ...info, status: "ok", chargePaise: res.walletCharge, receiverExtraPaise: res.receiverExtra || undefined }); }
      else out.push({ ...base, ...info, status: res.status, message: res.message });
    }
  }
  if (opts.commit) await audit({ actorUserId: opts.actorUserId, actorKind: opts.actorUserId ? "staff" : "system", action: "weight_dispute.import", targetType: "weight_dispute", targetId: "import", details: { rows: parsed.rows.length, created, totalChargePaise: total } });
  return { rows: out, created, totalChargePaise: total };
}
