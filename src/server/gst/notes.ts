import "server-only";
import { and, eq, or } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { fromInclusive } from "@/lib/gst";
import { newId } from "@/server/util/ids";
import { invoiceForShipment } from "./invoicing";
import { snapshotFor } from "./posting";

/**
 * Post a credit / debit note with its GST snapshot, linked to the shipment (AWB) and, when it was billed, to the
 * original invoice — so a prior-quarter invoice and a current-quarter note keep both periods and the reference.
 */
export async function postNote(a: {
  orgId: string; kind: "credit_note" | "debit_note"; totalPaise: number; reason: string;
  refType: string; refId: string | null; actor?: string | null; chargeType?: string;
}) {
  const db = await getDb();
  const { getSetting } = await import("@/server/quotes/service");
  const { nextDocNumber } = await import("@/server/billing");
  const rate = (await getSetting<number>("gst_bps", 1800)).value;
  const { taxablePaise, gstPaise } = fromInclusive(a.totalPaise, rate);

  let shipment: { id: string; awb: string | null } | null = null, originalDocId: string | null = null;
  if (a.refId && (a.refType === "shipment" || a.refType === "dispute")) {
    const sid = a.refType === "dispute"
      ? (await db.select({ s: schema.weightDisputes.shipmentId }).from(schema.weightDisputes).where(and(eq(schema.weightDisputes.id, a.refId), eq(schema.weightDisputes.orgId, a.orgId))))[0]?.s
      : null;
    const [s] = await db.select({ id: schema.shipments.id, awb: schema.shipments.awb }).from(schema.shipments)
      .where(and(eq(schema.shipments.orgId, a.orgId), sid ? eq(schema.shipments.id, sid) : or(eq(schema.shipments.id, a.refId), eq(schema.shipments.awb, a.refId))!));
    shipment = s ?? null;
    if (s) originalDocId = await invoiceForShipment(a.orgId, s.id, s.awb);
  } else if (a.refId && a.refType === "invoice") {
    const [inv] = await db.select({ id: schema.billingDocuments.id }).from(schema.billingDocuments)
      .where(and(eq(schema.billingDocuments.orgId, a.orgId), eq(schema.billingDocuments.kind, "invoice"), or(eq(schema.billingDocuments.number, a.refId), eq(schema.billingDocuments.id, a.refId))!));
    originalDocId = inv?.id ?? null;
  }

  const docDate = new Date();
  const line = {
    description: a.reason, ref: shipment?.awb ?? a.refId, taxablePaise, gstPaise, rateBps: rate,
    chargeType: a.chargeType ?? (a.refType === "dispute" ? "weight" : "other"), awb: shipment?.awb ?? null, shipmentId: shipment?.id ?? null,
  };
  const snap = await snapshotFor(a.orgId, [line], docDate);
  const id = newId("doc"), number = await nextDocNumber(a.kind, docDate);
  await db.insert(schema.billingDocuments).values({
    id, orgId: a.orgId, kind: a.kind, number, docDate, taxablePaise, gstPaise, totalPaise: a.totalPaise, reason: a.reason,
    refType: a.refType, refId: a.refId || null, lines: snap.lines, createdBy: a.actor ?? null, originalDocId, ...snap.fields,
  });
  return { id, number, taxablePaise, gstPaise };
}
