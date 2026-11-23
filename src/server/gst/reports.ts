import "server-only";
import { and, desc, eq, gte, ilike, inArray, lt, lte, or } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { splitGst, type GstSplit } from "@/lib/gst";
import type { PricedQuote } from "@/server/pricing/engine";
import { CHARGE_TYPES, shipmentLines } from "./invoicing";
import { companyTax, docTax, recipientOf, type DocLine, type DocTax } from "./posting";

/**
 * Customer GST reports. Totals come only from posted billing documents (invoice, credit note, debit note); money
 * received and used comes from the wallet ledger. Every query is scoped by the session's orgId.
 * Date basis: documents → document date; payments → payment date; delivered shipments → delivery date.
 */
type Doc = typeof schema.billingDocuments.$inferSelect;
export type DocRow = Doc & { tax: DocTax; originalNumber: string | null };
const ZERO: GstSplit = { cgstPaise: 0, sgstPaise: 0, utgstPaise: 0, igstPaise: 0 };
const add = (a: GstSplit, b: GstSplit, sign = 1): GstSplit => ({ cgstPaise: a.cgstPaise + sign * b.cgstPaise, sgstPaise: a.sgstPaise + sign * b.sgstPaise, utgstPaise: a.utgstPaise + sign * b.utgstPaise, igstPaise: a.igstPaise + sign * b.igstPaise });

async function orgOf(orgId: string) {
  const db = await getDb();
  const [o] = await db.select({ businessName: schema.orgs.businessName, gstin: schema.orgs.gstin, address: schema.orgs.address }).from(schema.orgs).where(eq(schema.orgs.id, orgId));
  return o ?? { businessName: "", gstin: null, address: null };
}

/** Posted documents in the period (document date), each with its GST split and the original invoice number for notes. */
export async function documents(orgId: string, from: Date, to: Date, q?: string): Promise<DocRow[]> {
  const db = await getDb();
  const conds = [eq(schema.billingDocuments.orgId, orgId), gte(schema.billingDocuments.docDate, from), lte(schema.billingDocuments.docDate, to)];
  const term = q?.trim().slice(0, 60);
  if (term) conds.push(ilike(schema.billingDocuments.number, `%${term.replace(/[%_]/g, "")}%`));
  const docs = await db.select().from(schema.billingDocuments).where(and(...conds)).orderBy(desc(schema.billingDocuments.docDate)).limit(2000);
  const company = await companyTax(), org = await orgOf(orgId);
  const origIds = [...new Set(docs.map((d) => d.originalDocId).filter((x): x is string => !!x))];
  const orig = origIds.length ? await db.select({ id: schema.billingDocuments.id, number: schema.billingDocuments.number }).from(schema.billingDocuments).where(and(eq(schema.billingDocuments.orgId, orgId), inArray(schema.billingDocuments.id, origIds))) : [];
  return docs.map((d) => ({ ...d, tax: docTax(d, company, org), originalNumber: orig.find((o) => o.id === d.originalDocId)?.number ?? (d.refType === "invoice" ? d.refId : null) }));
}

const PAY_KINDS = ["recharge_credit"];
const USE: Record<string, string> = {
  reserve_settle: "Shipment charges", weight_charge: "Weight charges", rto_charge: "RTO charges", credits_purchase: "Notification credits",
  store_plan: "Online Store plan", store_fee: "Online Store fees", adjustment_debit: "Debit adjustments", refund_debit: "Refund reversals", store_deposit: "Refundable deposits (not a service)",
};
const BACK: Record<string, string> = {
  refund_credit: "Refunds (cancelled shipments)", rto_credit: "RTO charge reductions", weight_reversal: "Weight charges reversed",
  adjustment_credit: "Credit adjustments", store_deposit_refund: "Deposit refunds",
};

export async function summary(orgId: string, from: Date, to: Date) {
  const db = await getDb();
  const docs = await documents(orgId, from, to);
  const block = (kind: string) => {
    const ds = docs.filter((d) => d.kind === kind);
    return { count: ds.length, taxablePaise: ds.reduce((t, d) => t + d.taxablePaise, 0), gstPaise: ds.reduce((t, d) => t + d.gstPaise, 0), totalPaise: ds.reduce((t, d) => t + d.totalPaise, 0), split: ds.reduce((t, d) => add(t, d.tax), ZERO) };
  };
  const inv = block("invoice"), cn = block("credit_note"), dn = block("debit_note");
  const net = {
    taxablePaise: inv.taxablePaise + dn.taxablePaise - cn.taxablePaise, gstPaise: inv.gstPaise + dn.gstPaise - cn.gstPaise,
    totalPaise: inv.totalPaise + dn.totalPaise - cn.totalPaise, split: add(add(inv.split, dn.split), cn.split, -1),
  };

  const [w] = await db.select().from(schema.wallets).where(eq(schema.wallets.orgId, orgId));
  const entries = w ? await db.select().from(schema.ledgerEntries).where(and(eq(schema.ledgerEntries.walletId, w.id), gte(schema.ledgerEntries.createdAt, from), lte(schema.ledgerEntries.createdAt, to))) : [];
  const [before] = w ? await db.select({ b: schema.ledgerEntries.balanceAfterPaise }).from(schema.ledgerEntries).where(and(eq(schema.ledgerEntries.walletId, w.id), lt(schema.ledgerEntries.createdAt, from))).orderBy(desc(schema.ledgerEntries.createdAt)).limit(1) : [];
  const posted = entries.filter((e) => e.amountPaise !== 0).sort((a, b) => +a.createdAt - +b.createdAt);
  const group = (map: Record<string, string>, sign: 1 | -1) => Object.entries(map).map(([kind, label]) => ({ kind, label, amountPaise: posted.filter((e) => e.kind === kind).reduce((t, e) => t + sign * e.amountPaise, 0) })).filter((g) => g.amountPaise !== 0);
  const payments = posted.filter((e) => PAY_KINDS.includes(e.kind));
  const used = group(USE, -1), back = group(BACK, 1);
  const known = new Set([...PAY_KINDS, ...Object.keys(USE), ...Object.keys(BACK)]);
  const other = posted.filter((e) => !known.has(e.kind)).reduce((t, e) => t + e.amountPaise, 0);
  return {
    invoices: inv, creditNotes: cn, debitNotes: dn, net, derived: docs.some((d) => d.tax.derived),
    payments: { count: payments.length, amountPaise: payments.reduce((t, e) => t + e.amountPaise, 0) },
    wallet: {
      openingPaise: before?.b ?? 0, closingPaise: posted.length ? posted[posted.length - 1].balanceAfterPaise : before?.b ?? 0,
      used, usedPaise: used.reduce((t, g) => t + g.amountPaise, 0), back, backPaise: back.reduce((t, g) => t + g.amountPaise, 0), otherPaise: other,
    },
  };
}

// ---------- AWB-wise charges ----------
export type AwbView = "all" | "delivered" | "rto" | "in_transit" | "cancelled";
export const AWB_VIEWS: Array<{ key: AwbView; label: string; basis: string }> = [
  { key: "all", label: "All Billed Services", basis: "booking date" }, { key: "delivered", label: "Delivered Shipments", basis: "delivery date" },
  { key: "rto", label: "RTO / Returned", basis: "booking date" }, { key: "in_transit", label: "In Transit", basis: "booking date" }, { key: "cancelled", label: "Cancelled", basis: "booking date" },
];
const RTO_ST = ["rto_initiated", "rto_in_transit", "rto_delivered"];
const DONE_ST = ["delivered", ...RTO_ST, "lost", "cancelled"];

export type AwbRow = {
  awb: string; shipmentId: string | null; orderNumber: string; courier: string; status: string; bookedAt: Date | null; deliveredAt: Date | null;
  chargeType: string; chargeLabel: string; description: string; taxablePaise: number; rateBps: number | null; split: GstSplit; gstPaise: number; grossPaise: number;
  document: string | null; documentKind: string | null; documentDate: Date | null; billing: "invoiced" | "note" | "not_invoiced";
  codValuePaise: number; codRemittance: string;
};

export async function awbCharges(orgId: string, from: Date, to: Date, view: AwbView = "all", q?: string): Promise<{ rows: AwbRow[]; nonShipment: AwbRow[]; truncated: boolean }> {
  const db = await getDb();
  const company = await companyTax(), org = await orgOf(orgId);
  const r = recipientOf(org);
  const { placeOfSupply } = await import("@/lib/gst");
  const pos = placeOfSupply({ recipientGstin: r.gstin, recipientState: r.state, supplierState: company.state });
  const { getSetting } = await import("@/server/quotes/service");
  const defaultBps = (await getSetting<number>("gst_bps", 1800)).value;

  const conds = [eq(schema.shipments.orgId, orgId)];
  if (view === "delivered") conds.push(eq(schema.shipments.status, "delivered"), gte(schema.shipments.deliveredAt, from), lte(schema.shipments.deliveredAt, to));
  else conds.push(gte(schema.shipments.createdAt, from), lte(schema.shipments.createdAt, to));
  const term = q?.trim().replace(/[%_]/g, "").slice(0, 60);
  // a document-number search finds the AWBs on that document
  let docHit: Doc | null = null;
  if (term) {
    [docHit] = await db.select().from(schema.billingDocuments).where(and(eq(schema.billingDocuments.orgId, orgId), eq(schema.billingDocuments.number, term)));
    if (!docHit) conds.push(or(ilike(schema.shipments.awb, `%${term}%`), ilike(schema.orders.orderNumber, `%${term}%`))!);
  }
  const LIMIT = 5000;
  let ships = await db.select({ s: schema.shipments, o: schema.orders, qt: schema.quotes }).from(schema.shipments)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.shipments.orderId)).leftJoin(schema.quotes, eq(schema.quotes.id, schema.shipments.quoteId))
    .where(and(...conds)).orderBy(desc(schema.shipments.createdAt)).limit(LIMIT + 1);
  const truncated = ships.length > LIMIT; ships = ships.slice(0, LIMIT);
  if (docHit) { const ids = new Set(((docHit.lines as DocLine[]) ?? []).map((l) => l.shipmentId).filter(Boolean)); ships = ships.filter(({ s }) => ids.has(s.id) || ((docHit!.lines as DocLine[]) ?? []).some((l) => l.ref === s.awb)); }
  if (view === "rto") ships = ships.filter(({ s }) => RTO_ST.includes(s.status));
  if (view === "in_transit") ships = ships.filter(({ s }) => s.bookingStatus === "confirmed" && !DONE_ST.includes(s.status));
  if (view === "cancelled") ships = ships.filter(({ s }) => s.bookingStatus === "cancelled" || s.status === "cancelled");

  // every posted document of this customer, indexed by the shipment / AWB its lines mention
  const docs = await db.select().from(schema.billingDocuments).where(eq(schema.billingDocuments.orgId, orgId));
  const byShip = new Map<string, Array<{ d: Doc; l: DocLine }>>();
  const nonShipment: AwbRow[] = [];
  for (const d of docs) for (const l of (d.lines as DocLine[]) ?? []) {
    const key = l.shipmentId ?? l.ref ?? "";
    if (l.chargeType === "non_shipment") {
      if (d.docDate >= from && d.docDate <= to) nonShipment.push(row({ awb: "—", shipmentId: null, orderNumber: l.ref ?? "", courier: "", status: "", bookedAt: null, deliveredAt: null }, l, d));
      continue;
    }
    if (!key) continue;
    if (!byShip.has(key)) byShip.set(key, []);
    byShip.get(key)!.push({ d, l });
  }
  const shipIds = ships.map(({ s }) => s.id);
  const rtoRows = shipIds.length ? await db.select().from(schema.rtoCharges).where(and(eq(schema.rtoCharges.orgId, orgId), inArray(schema.rtoCharges.shipmentId, shipIds))) : [];
  const remit = shipIds.length ? await db.select({ shipmentId: schema.codRemittanceItems.shipmentId, codPaise: schema.codRemittanceItems.codPaise, status: schema.codRemittances.status, paidAt: schema.codRemittances.paidAt, ref: schema.codRemittances.reference })
    .from(schema.codRemittanceItems).innerJoin(schema.codRemittances, eq(schema.codRemittances.id, schema.codRemittanceItems.remittanceId)).where(inArray(schema.codRemittanceItems.shipmentId, shipIds)) : [];

  function row(base: Pick<AwbRow, "awb" | "shipmentId" | "orderNumber" | "courier" | "status" | "bookedAt" | "deliveredAt"> & { codValuePaise?: number; codRemittance?: string }, l: DocLine, d: Doc | null): AwbRow {
    const sign = d?.kind === "credit_note" ? -1 : 1;
    const split = typeof l.cgstPaise === "number" || typeof l.igstPaise === "number"
      ? { cgstPaise: l.cgstPaise ?? 0, sgstPaise: l.sgstPaise ?? 0, utgstPaise: l.utgstPaise ?? 0, igstPaise: l.igstPaise ?? 0 }
      : splitGst(l.gstPaise, d?.supplierState ?? company.state, d?.placeOfSupply ?? pos);
    const type = l.chargeType ?? (d?.kind === "invoice" ? "forward" : "other");
    return {
      codValuePaise: 0, codRemittance: "", ...base, chargeType: type, chargeLabel: (d && d.kind !== "invoice" ? `${d.kind === "credit_note" ? "Credit note" : "Debit note"} — ` : "") + (CHARGE_TYPES[type] ?? type),
      description: l.description, taxablePaise: sign * l.taxablePaise, rateBps: l.rateBps ?? d?.rateBps ?? null,
      split: { cgstPaise: sign * split.cgstPaise, sgstPaise: sign * split.sgstPaise, utgstPaise: sign * split.utgstPaise, igstPaise: sign * split.igstPaise },
      gstPaise: sign * l.gstPaise, grossPaise: sign * (l.taxablePaise + l.gstPaise),
      document: d?.number ?? null, documentKind: d?.kind ?? null, documentDate: d?.docDate ?? null, billing: !d ? "not_invoiced" : d.kind === "invoice" ? "invoiced" : "note",
    };
  }

  const rows: AwbRow[] = [];
  for (const { s, o, qt } of ships) {
    const rm = remit.find((x) => x.shipmentId === s.id);
    const base = {
      awb: s.awb ?? s.id, shipmentId: s.id, orderNumber: o.orderNumber, courier: s.carrierName, status: s.bookingStatus === "cancelled" ? "cancelled" : s.status,
      bookedAt: s.createdAt, deliveredAt: s.deliveredAt, codValuePaise: o.paymentType === "cod" ? o.codAmountPaise : 0,
      codRemittance: o.paymentType !== "cod" ? "" : rm ? (rm.status === "paid" ? `Remitted ${rm.paidAt ? rm.paidAt.toISOString().slice(0, 10) : ""} ${rm.ref ?? ""}`.trim() : "Scheduled") : "Pending",
    };
    const posted = [...(byShip.get(s.id) ?? []), ...(s.awb ? byShip.get(s.awb) ?? [] : [])].filter((x, i, a) => a.findIndex((y) => y.d.id === x.d.id && y.l === x.l) === i);
    for (const { d, l } of posted) rows.push(row(base, l, d));
    // charges not on any document yet (booked this period, invoice not issued): shown so the customer sees all spend
    const keysPosted = new Set(posted.map(({ l }) => l.key).filter(Boolean));
    const hasLegacy = posted.some(({ d, l }) => d.kind === "invoice" && !l.key);
    if (s.bookingStatus === "confirmed" && !hasLegacy) for (const l of shipmentLines(s, qt?.priced as PricedQuote | undefined, defaultBps)) if (!keysPosted.has(l.key!)) rows.push(row(base, l, null));
    for (const rc of rtoRows.filter((x) => x.shipmentId === s.id && x.chargedPaise > 0)) {
      if (keysPosted.has(`rto:${rc.id}`)) continue;
      const g = rc.gstPaise != null && rc.finalPaise === rc.chargedPaise ? rc.gstPaise : Math.round((rc.chargedPaise * defaultBps) / (10_000 + defaultBps));
      rows.push(row(base, { key: `rto:${rc.id}`, chargeType: "rto", description: "RTO charge", taxablePaise: rc.chargedPaise - g, gstPaise: g, rateBps: defaultBps }, null));
    }
  }
  return { rows, nonShipment, truncated };
}
