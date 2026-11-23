import "server-only";
import { and, desc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { isGstin, taxPeriodOf, type GstSplit } from "@/lib/gst";
import { newId } from "@/server/util/ids";
import type { DocLine } from "./posting";

/**
 * Courier purchases (input GST): the bills Vishwaship receives from Delhivery and other couriers / aggregators,
 * their AWB annexures, the payments made against them, and the AWB-level comparison with what customers were billed.
 * Admin only (shipments.cost.read to read, finance.adjust to write). Amounts are exactly what the courier document says.
 */
export const BILL_KINDS = ["invoice", "credit_note", "debit_note"] as const;
export type BillKind = (typeof BILL_KINDS)[number];
export const LINE_TYPES = ["forward", "rto", "reverse", "weight", "cod", "fuel", "other"] as const;

export type BillInput = {
  kind: BillKind; supplierName: string; supplierGstin?: string; billedGstin?: string; number: string; docDate: string; originalNumber?: string;
  placeOfSupply?: string; taxablePaise: number; cgstPaise?: number; sgstPaise?: number; utgstPaise?: number; igstPaise?: number; totalPaise?: number;
  lines?: Array<{ awb?: string; chargeType?: string; taxablePaise: number; gstPaise?: number }>; notes?: string; fileKey?: string | null;
};
export type AddResult = { ok: true; id: string; matched: number; unmatched: number } | { ok: false; duplicate?: boolean; message: string };

const clean = (s?: string | null) => (s ?? "").trim();
const gstOf = (b: Pick<BillInput, "cgstPaise" | "sgstPaise" | "utgstPaise" | "igstPaise">) => (b.cgstPaise ?? 0) + (b.sgstPaise ?? 0) + (b.utgstPaise ?? 0) + (b.igstPaise ?? 0);

/** Match AWBs to shipments. An AWB that exists on more than one shipment is never guessed. */
async function matchAwbs(awbs: string[]) {
  const db = await getDb();
  const list = [...new Set(awbs.filter(Boolean))];
  const rows = list.length ? await db.select({ id: schema.shipments.id, awb: schema.shipments.awb, orgId: schema.shipments.orgId }).from(schema.shipments).where(inArray(schema.shipments.awb, list)) : [];
  const m = new Map<string, { id: string; orgId: string } | "ambiguous">();
  for (const r of rows) m.set(r.awb!, m.has(r.awb!) ? "ambiguous" : { id: r.id, orgId: r.orgId });
  return m;
}

export async function addCourierBill(b: BillInput, actor: string, opts: { source?: "manual" | "import"; batch?: string } = {}): Promise<AddResult> {
  const supplierName = clean(b.supplierName), number = clean(b.number);
  if (supplierName.length < 2) return { ok: false, message: "Courier / supplier name is required" };
  if (!number) return { ok: false, message: "Document number is required" };
  if (!BILL_KINDS.includes(b.kind)) return { ok: false, message: "Type must be invoice, credit_note or debit_note" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.docDate)) return { ok: false, message: `${number}: date must be YYYY-MM-DD` };
  const supplierGstin = clean(b.supplierGstin).toUpperCase(), billedGstin = clean(b.billedGstin).toUpperCase();
  if (supplierGstin && !isGstin(supplierGstin)) return { ok: false, message: `${number}: supplier GSTIN ${supplierGstin} is not a valid GSTIN` };
  if (billedGstin && !isGstin(billedGstin)) return { ok: false, message: `${number}: billed GSTIN ${billedGstin} is not a valid GSTIN` };
  if (!Number.isSafeInteger(b.taxablePaise) || b.taxablePaise < 0) return { ok: false, message: `${number}: taxable value must be 0 or more` };
  const gst = gstOf(b);
  const total = b.totalPaise ?? b.taxablePaise + gst;
  // the document must add up (₹1 tolerance for the courier's own rounding)
  if (Math.abs(b.taxablePaise + gst - total) > 100) return { ok: false, message: `${number}: taxable ${b.taxablePaise / 100} + GST ${gst / 100} does not equal total ${total / 100}` };

  const db = await getDb();
  const [dup] = await db.select({ id: schema.courierBills.id }).from(schema.courierBills).where(and(eq(schema.courierBills.supplierName, supplierName), eq(schema.courierBills.kind, b.kind), eq(schema.courierBills.number, number)));
  if (dup) return { ok: false, duplicate: true, message: `${supplierName} ${b.kind.replace("_", " ")} ${number} is already recorded` };
  let originalBillId: string | null = null;
  if (b.kind !== "invoice" && clean(b.originalNumber)) {
    const [o] = await db.select({ id: schema.courierBills.id }).from(schema.courierBills).where(and(eq(schema.courierBills.supplierName, supplierName), eq(schema.courierBills.kind, "invoice"), eq(schema.courierBills.number, clean(b.originalNumber))));
    originalBillId = o?.id ?? null;
  }
  const docDate = new Date(`${b.docDate}T12:00:00+05:30`);
  const id = newId("cbill");
  const lines = (b.lines ?? []).filter((l) => l.taxablePaise || l.gstPaise);
  const match = await matchAwbs(lines.map((l) => clean(l.awb)));
  let matched = 0;
  const lineRows = lines.map((l) => {
    const awb = clean(l.awb) || null, hit = awb ? match.get(awb) : undefined;
    const ok = hit && hit !== "ambiguous";
    if (ok) matched++;
    const type = LINE_TYPES.includes((l.chargeType ?? "forward") as (typeof LINE_TYPES)[number]) ? l.chargeType ?? "forward" : "other";
    return {
      id: newId("cbl"), billId: id, awb, shipmentId: ok ? hit.id : null, orgId: ok ? hit.orgId : null, chargeType: type,
      taxablePaise: l.taxablePaise, gstPaise: l.gstPaise ?? 0, totalPaise: l.taxablePaise + (l.gstPaise ?? 0), matchStatus: ok ? "matched" : "unmatched",
      note: !awb ? "No AWB on this line (invoice-level charge)" : hit === "ambiguous" ? "AWB found on more than one shipment" : !hit ? "AWB not found in Vishwaship shipments" : null,
    };
  });
  await db.transaction(async (tx) => {
    await tx.insert(schema.courierBills).values({
      id, kind: b.kind, supplierName, supplierGstin: supplierGstin || null, billedGstin: billedGstin || null, number, docDate, originalBillId,
      placeOfSupply: clean(b.placeOfSupply) || null, taxablePaise: b.taxablePaise, cgstPaise: b.cgstPaise ?? 0, sgstPaise: b.sgstPaise ?? 0, utgstPaise: b.utgstPaise ?? 0,
      igstPaise: b.igstPaise ?? 0, totalPaise: total, taxPeriod: taxPeriodOf(docDate), fileKey: b.fileKey ?? null, source: opts.source ?? "manual", importBatch: opts.batch ?? null,
      notes: clean(b.notes) || null, createdBy: actor,
    });
    if (lineRows.length) await tx.insert(schema.courierBillLines).values(lineRows);
  });
  return { ok: true, id, matched, unmatched: lineRows.length - matched };
}

/** Import template (CSV or the first sheet of an .xlsx): one row per AWB line; header columns repeat per row. */
export const IMPORT_COLUMNS = [
  "supplier_name", "supplier_gstin", "billed_gstin", "doc_type", "doc_number", "doc_date", "original_doc_number", "place_of_supply",
  "taxable", "cgst", "sgst", "utgst", "igst", "total", "awb", "charge_type", "line_taxable", "line_gst",
] as const;
export const IMPORT_SAMPLE = ["Delhivery Ltd", "27AAACD1234F1Z5", "07AAACV1234Q1Z2", "invoice", "DLV/24-25/001", "2026-11-15", "", "07", "1000.00", "0", "0", "0", "180.00", "1180.00", "1234567890123", "forward", "1000.00", "180.00"];

const toPaise = (s: string | undefined) => { const n = Number(String(s ?? "").replace(/[₹,\s]/g, "")); return Number.isFinite(n) ? Math.round(n * 100) : NaN; };

export async function importCourierRows(rows: string[][], actor: string) {
  const [head, ...body] = rows;
  const idx = (c: string) => (head ?? []).findIndex((h) => h.trim().toLowerCase() === c);
  const missing = ["supplier_name", "doc_type", "doc_number", "doc_date", "taxable"].filter((c) => idx(c) < 0);
  if (missing.length) return { created: 0, duplicates: [] as string[], errors: [`Missing columns: ${missing.join(", ")}. Download the template.`], matched: 0, unmatched: 0 };
  const get = (r: string[], c: string) => (idx(c) >= 0 ? (r[idx(c)] ?? "").trim() : "");
  const groups = new Map<string, string[][]>();
  for (const r of body.slice(0, 20_000)) {
    const k = `${get(r, "supplier_name")}|${get(r, "doc_type").toLowerCase()}|${get(r, "doc_number")}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  const batch = newId("cimp");
  const out = { created: 0, duplicates: [] as string[], errors: [] as string[], matched: 0, unmatched: 0 };
  for (const rs of groups.values()) {
    const f = rs[0];
    const money = (c: string) => toPaise(get(f, c) || "0");
    const input: BillInput = {
      kind: get(f, "doc_type").toLowerCase().replace(/\s+/g, "_") as BillKind, supplierName: get(f, "supplier_name"), supplierGstin: get(f, "supplier_gstin"), billedGstin: get(f, "billed_gstin"),
      number: get(f, "doc_number"), docDate: get(f, "doc_date"), originalNumber: get(f, "original_doc_number"), placeOfSupply: get(f, "place_of_supply"),
      taxablePaise: money("taxable"), cgstPaise: money("cgst"), sgstPaise: money("sgst"), utgstPaise: money("utgst"), igstPaise: money("igst"),
      totalPaise: get(f, "total") ? money("total") : undefined,
      lines: rs.filter((r) => get(r, "awb") || get(r, "line_taxable")).map((r) => ({ awb: get(r, "awb"), chargeType: get(r, "charge_type").toLowerCase() || "forward", taxablePaise: toPaise(get(r, "line_taxable") || "0"), gstPaise: toPaise(get(r, "line_gst") || "0") })),
    };
    if ([input.taxablePaise, input.cgstPaise, input.sgstPaise, input.utgstPaise, input.igstPaise].some((n) => Number.isNaN(n)) || (input.lines ?? []).some((l) => Number.isNaN(l.taxablePaise) || Number.isNaN(l.gstPaise))) {
      out.errors.push(`${input.number || "(no number)"}: an amount is not a number`); continue;
    }
    const r = await addCourierBill(input, actor, { source: "import", batch });
    if (r.ok) { out.created++; out.matched += r.matched; out.unmatched += r.unmatched; }
    else if (r.duplicate) out.duplicates.push(r.message);
    else out.errors.push(r.message);
  }
  return out;
}

/** Record money paid to a courier, allocated to bills only as the settlement says. Same supplier + reference twice is refused. */
export async function recordCourierPayment(p: { supplierName: string; amountPaise: number; paidAt: string; reference: string; method?: string; notes?: string; allocations: Array<{ billNumber: string; amountPaise: number }> }, actor: string) {
  const supplierName = clean(p.supplierName), reference = clean(p.reference);
  if (!supplierName || !reference) return { ok: false as const, message: "Supplier and payment reference are required" };
  if (!(p.amountPaise > 0)) return { ok: false as const, message: "Amount must be more than 0" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.paidAt)) return { ok: false as const, message: "Payment date must be YYYY-MM-DD" };
  const allocated = p.allocations.reduce((t, a) => t + a.amountPaise, 0);
  if (allocated > p.amountPaise) return { ok: false as const, message: "Allocations are more than the payment" };
  const db = await getDb();
  const [dup] = await db.select({ id: schema.courierPayments.id }).from(schema.courierPayments).where(and(eq(schema.courierPayments.supplierName, supplierName), eq(schema.courierPayments.reference, reference)));
  if (dup) return { ok: false as const, duplicate: true, message: `Payment ${reference} to ${supplierName} is already recorded` };
  const bal = await billBalances(supplierName);
  const allocs: Array<{ billId: string; amountPaise: number }> = [];
  for (const a of p.allocations.filter((x) => x.amountPaise > 0)) {
    const b = bal.find((x) => x.number === clean(a.billNumber) && x.kind === "invoice");
    if (!b) return { ok: false as const, message: `Invoice ${a.billNumber} of ${supplierName} not found` };
    if (a.amountPaise > b.outstandingPaise) return { ok: false as const, message: `Invoice ${b.number}: only ₹${(b.outstandingPaise / 100).toFixed(2)} is outstanding` };
    allocs.push({ billId: b.id, amountPaise: a.amountPaise });
  }
  const id = newId("cpay");
  await db.transaction(async (tx) => {
    await tx.insert(schema.courierPayments).values({ id, supplierName, amountPaise: p.amountPaise, paidAt: new Date(`${p.paidAt}T12:00:00+05:30`), reference, method: clean(p.method) || null, notes: clean(p.notes) || null, createdBy: actor });
    if (allocs.length) await tx.insert(schema.courierPaymentAllocations).values(allocs.map((a) => ({ id: newId("cpal"), paymentId: id, billId: a.billId, amountPaise: a.amountPaise })));
  });
  return { ok: true as const, id, unallocatedPaise: p.amountPaise - allocated };
}

export type BillBalance = typeof schema.courierBills.$inferSelect & {
  gstPaise: number; notesNetPaise: number; payablePaise: number; paidPaise: number; outstandingPaise: number;
  /** GST inside the amount paid — only from allocations (proportional to the bill's GST share). */
  gstInPaidPaise: number;
};
/** Per courier invoice: its credit / debit notes, what was paid against it, and what is still outstanding. */
export async function billBalances(supplierName?: string, from?: Date, to?: Date): Promise<BillBalance[]> {
  const db = await getDb();
  const conds = [];
  if (supplierName) conds.push(eq(schema.courierBills.supplierName, supplierName));
  if (from) conds.push(gte(schema.courierBills.docDate, from));
  if (to) conds.push(lte(schema.courierBills.docDate, to));
  const bills = await db.select().from(schema.courierBills).where(conds.length ? and(...conds) : undefined).orderBy(desc(schema.courierBills.docDate)).limit(5000);
  const ids = bills.map((b) => b.id);
  const notes = ids.length ? await db.select().from(schema.courierBills).where(inArray(schema.courierBills.originalBillId, ids)) : [];
  const allocs = ids.length ? await db.select().from(schema.courierPaymentAllocations).where(inArray(schema.courierPaymentAllocations.billId, ids)) : [];
  return bills.map((b) => {
    const gst = b.cgstPaise + b.sgstPaise + b.utgstPaise + b.igstPaise;
    const mine = notes.filter((n) => n.originalBillId === b.id && b.kind === "invoice");
    const notesNet = mine.reduce((t, n) => t + (n.kind === "debit_note" ? n.totalPaise : -n.totalPaise), 0);
    const payable = b.kind === "invoice" ? b.totalPaise + notesNet : 0;
    const paid = allocs.filter((a) => a.billId === b.id).reduce((t, a) => t + a.amountPaise, 0);
    return { ...b, gstPaise: gst, notesNetPaise: notesNet, payablePaise: payable, paidPaise: paid, outstandingPaise: Math.max(0, payable - paid), gstInPaidPaise: b.totalPaise > 0 ? Math.round((paid * gst) / b.totalPaise) : 0 };
  });
}

/** Per supplier: GST charged (invoices + debit notes − credit notes), paid, unallocated payments, outstanding. */
export async function supplierSummary(from?: Date, to?: Date) {
  const db = await getDb();
  const bills = await billBalances(undefined, from, to);
  const payConds = [];
  if (from) payConds.push(gte(schema.courierPayments.paidAt, from));
  if (to) payConds.push(lte(schema.courierPayments.paidAt, to));
  const pays = await db.select().from(schema.courierPayments).where(payConds.length ? and(...payConds) : undefined);
  const names = [...new Set([...bills.map((b) => b.supplierName), ...pays.map((p) => p.supplierName)])].sort();
  return names.map((n) => {
    const bs = bills.filter((b) => b.supplierName === n), sign = (b: BillBalance) => (b.kind === "credit_note" ? -1 : 1);
    const split = bs.reduce<GstSplit>((t, b) => ({ cgstPaise: t.cgstPaise + sign(b) * b.cgstPaise, sgstPaise: t.sgstPaise + sign(b) * b.sgstPaise, utgstPaise: t.utgstPaise + sign(b) * b.utgstPaise, igstPaise: t.igstPaise + sign(b) * b.igstPaise }), { cgstPaise: 0, sgstPaise: 0, utgstPaise: 0, igstPaise: 0 });
    const paidTotal = pays.filter((p) => p.supplierName === n).reduce((t, p) => t + p.amountPaise, 0);
    const allocated = bs.reduce((t, b) => t + b.paidPaise, 0);
    return {
      supplierName: n, gstins: [...new Set(bs.map((b) => b.supplierGstin).filter(Boolean))] as string[], documents: bs.length,
      taxablePaise: bs.reduce((t, b) => t + sign(b) * b.taxablePaise, 0), split, gstPaise: split.cgstPaise + split.sgstPaise + split.utgstPaise + split.igstPaise,
      grossPaise: bs.reduce((t, b) => t + sign(b) * b.totalPaise, 0), paidPaise: paidTotal, unallocatedPaise: Math.max(0, paidTotal - allocated),
      outstandingPaise: bs.reduce((t, b) => t + b.outstandingPaise, 0), gstInPaidPaise: bs.reduce((t, b) => t + b.gstInPaidPaise, 0),
    };
  });
}

/** Unmatched queue: lines without a shipment, bills without a supplier GSTIN. */
export async function unmatched() {
  const db = await getDb();
  const lines = await db.select({ l: schema.courierBillLines, b: schema.courierBills }).from(schema.courierBillLines).innerJoin(schema.courierBills, eq(schema.courierBills.id, schema.courierBillLines.billId))
    .where(eq(schema.courierBillLines.matchStatus, "unmatched")).orderBy(desc(schema.courierBills.docDate)).limit(2000);
  const noGstin = await db.select().from(schema.courierBills).where(or(isNull(schema.courierBills.supplierGstin), eq(schema.courierBills.supplierGstin, ""))!).orderBy(desc(schema.courierBills.docDate)).limit(500);
  return { lines, noGstin };
}

/** Re-try AWB matching for unmatched lines (after shipments sync), or mark a line reviewed. */
export async function rematch() {
  const db = await getDb();
  const open = await db.select().from(schema.courierBillLines).where(eq(schema.courierBillLines.matchStatus, "unmatched")).limit(5000);
  const m = await matchAwbs(open.map((l) => l.awb ?? ""));
  let fixed = 0;
  for (const l of open) {
    const hit = l.awb ? m.get(l.awb) : undefined;
    if (hit && hit !== "ambiguous") { await db.update(schema.courierBillLines).set({ shipmentId: hit.id, orgId: hit.orgId, matchStatus: "matched", note: null }).where(eq(schema.courierBillLines.id, l.id)); fixed++; }
  }
  return fixed;
}
export async function resolveLine(id: string, note: string) {
  const db = await getDb();
  await db.update(schema.courierBillLines).set({ matchStatus: "resolved", note: note.slice(0, 300) }).where(eq(schema.courierBillLines.id, id));
}

/** AWB reconciliation: what the customer was billed vs what the courier billed, per AWB and charge type. */
export async function awbReconciliation(from: Date, to: Date, q?: string) {
  const db = await getDb();
  const conds = [gte(schema.shipments.createdAt, from), lte(schema.shipments.createdAt, to)];
  const term = q?.trim();
  if (term) conds.push(eq(schema.shipments.awb, term));
  const ships = await db.select({ id: schema.shipments.id, awb: schema.shipments.awb, orgId: schema.shipments.orgId, carrier: schema.shipments.carrierName, status: schema.shipments.status, business: schema.orgs.businessName })
    .from(schema.shipments).innerJoin(schema.orgs, eq(schema.orgs.id, schema.shipments.orgId)).where(and(...conds)).orderBy(desc(schema.shipments.createdAt)).limit(3000);
  const ids = ships.map((s) => s.id), orgIds = [...new Set(ships.map((s) => s.orgId))];
  const docs = orgIds.length ? await db.select().from(schema.billingDocuments).where(inArray(schema.billingDocuments.orgId, orgIds)) : [];
  const cl = ids.length ? await db.select({ l: schema.courierBillLines, kind: schema.courierBills.kind, number: schema.courierBills.number }).from(schema.courierBillLines)
    .innerJoin(schema.courierBills, eq(schema.courierBills.id, schema.courierBillLines.billId)).where(inArray(schema.courierBillLines.shipmentId, ids)) : [];
  type Cell = { custTaxable: number; custGst: number; courierTaxable: number; courierGst: number };
  return ships.map((s) => {
    const by = new Map<string, Cell>();
    const cell = (t: string) => { if (!by.has(t)) by.set(t, { custTaxable: 0, custGst: 0, courierTaxable: 0, courierGst: 0 }); return by.get(t)!; };
    for (const d of docs.filter((x) => x.orgId === s.orgId)) for (const l of (d.lines as DocLine[]) ?? []) {
      if (l.shipmentId !== s.id && l.ref !== s.awb && l.ref !== s.id) continue;
      const sign = d.kind === "credit_note" ? -1 : 1, c = cell(l.chargeType === "fuel" || l.chargeType === "cod" || l.chargeType === "other" ? "forward" : l.chargeType ?? "forward");
      c.custTaxable += sign * l.taxablePaise; c.custGst += sign * l.gstPaise;
    }
    for (const { l, kind } of cl.filter((x) => x.l.shipmentId === s.id)) {
      const sign = kind === "credit_note" ? -1 : 1, c = cell(l.chargeType === "fuel" || l.chargeType === "cod" || l.chargeType === "other" ? "forward" : l.chargeType);
      c.courierTaxable += sign * l.taxablePaise; c.courierGst += sign * l.gstPaise;
    }
    const cells = [...by.entries()].map(([type, c]) => ({ type, ...c, differencePaise: c.custTaxable - c.courierTaxable }));
    const tot = cells.reduce((t, c) => ({ custTaxable: t.custTaxable + c.custTaxable, custGst: t.custGst + c.custGst, courierTaxable: t.courierTaxable + c.courierTaxable, courierGst: t.courierGst + c.courierGst }), { custTaxable: 0, custGst: 0, courierTaxable: 0, courierGst: 0 });
    const courierDocs = [...new Set(cl.filter((x) => x.l.shipmentId === s.id).map((x) => x.number))];
    return { ...s, cells, ...tot, differencePaise: tot.custTaxable - tot.courierTaxable, courierDocs, match: tot.courierTaxable === 0 && tot.courierGst === 0 ? "no_courier_bill" : tot.custTaxable === 0 ? "not_billed_to_customer" : "matched" };
  });
}

