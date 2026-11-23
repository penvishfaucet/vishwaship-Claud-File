import "server-only";
import { asc, desc, eq, or } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { type Milestone, type ScanLine, buildMilestones, buildScans, maskPhones } from "@/lib/tracking-timeline";
import { hideProviders } from "@/server/customer-safe";

export const STATUS_LABEL: Record<string, string> = {
  booked: "Booked", pickup_pending: "Pickup pending", picked_up: "Picked up", in_transit: "In transit",
  at_delivery_center: "At delivery centre", out_for_delivery: "Out for delivery", delivered: "Delivered",
  ndr: "Delivery attempted", cancelled: "Cancelled", rto_initiated: "Return initiated", rto_in_transit: "Returning to origin",
  rto_delivered: "Returned to origin", lost: "Under investigation", reverse_in_transit: "Return pickup in transit", reverse_delivered: "Return delivered",
};

export type PublicTrack =
  | { kind: "invalid" }
  | { kind: "not_found" }
  | { kind: "awb_pending"; carrierName: string; serviceName: string }
  | {
    kind: "found"; awb: string; lr: string | null; carrierName: string; carrierCode: string; serviceName: string;
    status: string; statusLabel: string; etaDate: string | null; deliveredAt: string | null;
    lastLocation: string | null; lastAt: string | null; stale: boolean; isDemo: boolean;
    events: Array<{ status: string; location: string | null; at: string }>;
    milestones: Milestone[]; scans: ScanLine[];
  };

/**
 * Public tracking by AWB or LR/LRN. Reads the same shipment record the portals use (kept current by carrier
 * webhooks and the background poll). Returns buyer-facing facts only: carrier, service, status, ETA and a scan
 * timeline (status, city, time) — never names, phone numbers, addresses, documents, charges or account data.
 */
export async function publicTrack(raw: string): Promise<PublicTrack> {
  const q = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (!/^[A-Z0-9-]{6,40}$/.test(q)) return { kind: "invalid" };
  const db = await getDb();
  const rows = await db.select().from(schema.shipments).where(or(eq(schema.shipments.awb, q), eq(schema.shipments.lrNumber, q), eq(schema.shipments.providerOrderRef, q)))
    .orderBy(desc(schema.shipments.createdAt)).limit(1);
  const s = rows[0];
  if (!s || s.bookingStatus === "failed") return { kind: "not_found" };
  if (!s.awb) return { kind: "awb_pending", carrierName: s.carrierName, serviceName: s.serviceName };
  const events = await db.select({ status: schema.shipmentEvents.status, location: schema.shipmentEvents.location, occurredAt: schema.shipmentEvents.occurredAt, rawStatus: schema.shipmentEvents.rawStatus, remark: schema.shipmentEvents.remark })
    .from(schema.shipmentEvents).where(eq(schema.shipmentEvents.shipmentId, s.id)).orderBy(asc(schema.shipmentEvents.occurredAt));
  const last = events[events.length - 1];
  const lastWithPlace = [...events].reverse().find((e) => e.location);
  const delivered = [...events].reverse().find((e) => e.status === "delivered" || e.status === "reverse_delivered");
  const active = !["delivered", "rto_delivered", "cancelled", "lost", "reverse_delivered"].includes(s.status);
  // No courier scan for 3 days on an active shipment → tell the buyer updates may be delayed.
  const stale = active && s.provider !== "demo" && Date.now() - (last?.occurredAt ?? s.createdAt).getTime() > 3 * 86400_000;
  return {
    kind: "found", awb: s.awb, lr: s.lrNumber && s.lrNumber !== s.awb ? s.lrNumber : null, carrierName: s.carrierName, carrierCode: s.carrierCode, serviceName: s.serviceName,
    status: s.status, statusLabel: STATUS_LABEL[s.status] ?? s.status, etaDate: s.etaDate?.toISOString() ?? null, deliveredAt: delivered?.occurredAt.toISOString() ?? null,
    lastLocation: lastWithPlace?.location ?? null, lastAt: last?.occurredAt.toISOString() ?? null, stale, isDemo: s.provider === "demo",
    events: events.map((e) => ({ status: STATUS_LABEL[e.status] ?? e.status, location: e.location ?? null, at: e.occurredAt.toISOString() })),
    milestones: buildMilestones(events, s.status, s.createdAt), scans: buildScans(events, publicClean),
  };
}

/** Scan text shown to anyone with the AWB: no internal partner names, no phone numbers. */
export const publicClean = (t: string) => maskPhones(hideProviders(t));
