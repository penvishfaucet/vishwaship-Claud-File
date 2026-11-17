import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";

export const STATUS_LABEL: Record<string, string> = {
  booked: "Booked", pickup_pending: "Pickup pending", picked_up: "Picked up", in_transit: "In transit",
  at_delivery_center: "At delivery centre", out_for_delivery: "Out for delivery", delivered: "Delivered",
  ndr: "Delivery attempted", cancelled: "Cancelled", rto_initiated: "Return initiated", rto_in_transit: "Returning to origin",
  rto_delivered: "Returned to origin", lost: "Under investigation", reverse_in_transit: "Return pickup in transit", reverse_delivered: "Return delivered",
};

/**
 * Public tracking: carrier, status, ETA and a scan timeline (status + city + time) only.
 * Never returns recipient/sender details, phone numbers, documents, charges or account data.
 */
export async function publicTrack(awbRaw: string) {
  const awb = awbRaw.trim().toUpperCase();
  if (!/^[A-Z0-9-]{6,40}$/.test(awb)) return null;
  const db = await getDb();
  const [s] = await db.select({
    id: schema.shipments.id, awb: schema.shipments.awb, carrierName: schema.shipments.carrierName,
    carrierCode: schema.shipments.carrierCode, status: schema.shipments.status, etaDate: schema.shipments.etaDate,
    provider: schema.shipments.provider,
  }).from(schema.shipments).where(and(eq(schema.shipments.awb, awb)));
  if (!s) return null;
  const events = await db.select({
    status: schema.shipmentEvents.status, location: schema.shipmentEvents.location, occurredAt: schema.shipmentEvents.occurredAt,
  }).from(schema.shipmentEvents).where(eq(schema.shipmentEvents.shipmentId, s.id)).orderBy(asc(schema.shipmentEvents.occurredAt));
  return {
    awb: s.awb!, carrierName: s.carrierName, carrierCode: s.carrierCode, status: s.status,
    statusLabel: STATUS_LABEL[s.status] ?? s.status, etaDate: s.etaDate?.toISOString() ?? null, isDemo: s.provider === "demo",
    events: events.map((e) => ({ status: STATUS_LABEL[e.status] ?? e.status, location: e.location ?? null, at: e.occurredAt.toISOString() })),
  };
}
