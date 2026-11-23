import "server-only";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { fromInclusive } from "@/lib/gst";
import type { PricedQuote } from "@/server/pricing/engine";
import type { DocLine } from "./posting";

/**
 * Lines for a period invoice. Every billable item has a stable key (ship:<id>:<code>, rto:<id>, led:<ledgerId>) and
 * an item already on a posted invoice is never billed again — a retried job or a second click cannot double-bill.
 *  - Shipments booked in the period (confirmed): one line per priced component (freight, fuel, COD fee …).
 *  - RTO charges posted to the wallet in the period.
 *  - Non-shipment services debited from the wallet in the period (notification credits, Online Store plan / fees).
 * Refundable deposits are not supplies and are never invoiced.
 */
export const CHARGE_TYPES: Record<string, string> = {
  forward: "Forward freight", fuel: "Fuel surcharge", cod: "COD handling fee", rto: "RTO", reverse: "Reverse pickup",
  weight: "Weight adjustment", other: "Other shipment services", non_shipment: "Non-shipment services",
};
const CODE_TYPE: Record<string, string> = { freight: "forward", fuel: "fuel", cod_fee: "cod", rto: "rto", reverse: "reverse" };
const NON_SHIPMENT: Record<string, string> = { credits_purchase: "Notification credits", store_plan: "Online Store plan", store_fee: "Online Store fee (delivered orders)" };

/** Keys (and legacy refs) already on this customer's invoices. */
export async function invoicedKeys(orgId: string) {
  const db = await getDb();
  const docs = await db.select({ lines: schema.billingDocuments.lines }).from(schema.billingDocuments).where(and(eq(schema.billingDocuments.orgId, orgId), eq(schema.billingDocuments.kind, "invoice")));
  const keys = new Set<string>(), legacyRefs = new Set<string>();
  for (const d of docs) for (const l of (d.lines as DocLine[]) ?? []) { if (l.key) keys.add(l.key); else if (l.ref) legacyRefs.add(l.ref); if (l.shipmentId) legacyRefs.add(l.shipmentId); }
  return { keys, legacyRefs };
}

/** Split a booking's price into per-component lines that add up exactly to what the customer paid. */
export function shipmentLines(s: { id: string; awb: string | null; sellPaise: number; carrierName: string; serviceName: string }, p: PricedQuote | null | undefined, defaultBps: number): DocLine[] {
  const base = { awb: s.awb, shipmentId: s.id, ref: s.awb ?? s.id };
  const comps = (p?.lines ?? []).filter((l) => l.sellPreTax > 0);
  const subtotal = comps.reduce((t, l) => t + l.sellPreTax, 0);
  if (p && comps.length && subtotal + p.gst === s.sellPaise) {
    let gstLeft = p.gst;
    return comps.map((l, i) => {
      const g = i === comps.length - 1 ? gstLeft : Math.round((l.sellPreTax * p.gst) / subtotal);
      gstLeft -= g;
      const type = CODE_TYPE[l.code] ?? "other";
      return { ...base, key: `ship:${s.id}:${l.code}`, chargeType: type, description: `${l.label} — ${s.carrierName} ${s.serviceName}`.trim(), taxablePaise: l.sellPreTax, gstPaise: g, rateBps: p.gstBps };
    });
  }
  // FOD (receiver pays freight) or no saved breakdown: what the sender paid, tax-inclusive at the booking's rate
  const rate = p?.gstBps ?? defaultBps;
  const { taxablePaise, gstPaise } = fromInclusive(s.sellPaise, rate);
  return s.sellPaise > 0 ? [{ ...base, key: `ship:${s.id}`, chargeType: "forward", description: `Shipping — ${s.carrierName} ${s.serviceName}`.trim(), taxablePaise, gstPaise, rateBps: rate }] : [];
}

export async function collectInvoiceLines(orgId: string, from: Date, to: Date, defaultBps: number) {
  const db = await getDb();
  const { keys, legacyRefs } = await invoicedKeys(orgId);
  const lines: DocLine[] = [];
  let shipments = 0;

  const ships = await db.select({ s: schema.shipments, q: schema.quotes }).from(schema.shipments).leftJoin(schema.quotes, eq(schema.quotes.id, schema.shipments.quoteId))
    .where(and(eq(schema.shipments.orgId, orgId), gte(schema.shipments.createdAt, from), lte(schema.shipments.createdAt, to), eq(schema.shipments.bookingStatus, "confirmed")));
  for (const { s, q } of ships) {
    if (legacyRefs.has(s.id) || (s.awb && legacyRefs.has(s.awb))) continue; // on an invoice issued before line keys existed
    const ls = shipmentLines(s, q?.priced as PricedQuote | undefined, defaultBps).filter((l) => !keys.has(l.key!));
    if (ls.length) { lines.push(...ls); shipments++; }
  }

  const rto = await db.select({ r: schema.rtoCharges, awb: schema.shipments.awb, carrier: schema.shipments.carrierName }).from(schema.rtoCharges)
    .innerJoin(schema.shipments, eq(schema.shipments.id, schema.rtoCharges.shipmentId))
    .where(and(eq(schema.rtoCharges.orgId, orgId), gte(schema.rtoCharges.updatedAt, from), lte(schema.rtoCharges.updatedAt, to)));
  for (const { r, awb, carrier } of rto) {
    const key = `rto:${r.id}`;
    if (r.chargedPaise <= 0 || keys.has(key)) continue;
    const gst = r.gstPaise != null && r.finalPaise === r.chargedPaise ? r.gstPaise : fromInclusive(r.chargedPaise, defaultBps).gstPaise;
    lines.push({ key, chargeType: "rto", awb, shipmentId: r.shipmentId, ref: awb ?? r.shipmentId, description: `RTO charge — ${carrier}`, taxablePaise: r.chargedPaise - gst, gstPaise: gst, rateBps: defaultBps });
  }

  const [w] = await db.select({ id: schema.wallets.id }).from(schema.wallets).where(eq(schema.wallets.orgId, orgId));
  if (w) {
    const led = await db.select().from(schema.ledgerEntries).where(and(eq(schema.ledgerEntries.walletId, w.id), inArray(schema.ledgerEntries.kind, Object.keys(NON_SHIPMENT)), gte(schema.ledgerEntries.createdAt, from), lte(schema.ledgerEntries.createdAt, to)));
    for (const e of led) {
      const key = `led:${e.id}`;
      if (e.amountPaise >= 0 || keys.has(key)) continue;
      const { taxablePaise, gstPaise } = fromInclusive(-e.amountPaise, defaultBps);
      lines.push({ key, chargeType: "non_shipment", ref: e.refId ?? e.id, description: e.memo || NON_SHIPMENT[e.kind], taxablePaise, gstPaise, rateBps: defaultBps });
    }
  }
  return { lines, shipments };
}

/** The posted invoice that billed a shipment (for linking a credit / debit note to its original invoice). */
export async function invoiceForShipment(orgId: string, shipmentId: string, awb: string | null) {
  const db = await getDb();
  const docs = await db.select({ id: schema.billingDocuments.id, lines: schema.billingDocuments.lines, docDate: schema.billingDocuments.docDate }).from(schema.billingDocuments)
    .where(and(eq(schema.billingDocuments.orgId, orgId), eq(schema.billingDocuments.kind, "invoice")));
  const hit = docs.find((d) => ((d.lines as DocLine[]) ?? []).some((l) => l.shipmentId === shipmentId || l.ref === shipmentId || (!!awb && l.ref === awb)));
  return hit?.id ?? null;
}
