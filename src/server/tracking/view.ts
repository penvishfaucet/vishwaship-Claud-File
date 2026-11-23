import "server-only";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import type { TrackShipment } from "@/components/tracking/ShipmentTracking";
import { buildMilestones, buildScans } from "@/lib/tracking-timeline";
import { statusLabel } from "@/lib/status";
import { hideProviders } from "@/server/customer-safe";
import { getDb, schema } from "@/server/db/client";
import { podView } from "./pod";

/**
 * Tracking cards for every shipment of an order (rebooked orders have several). `orgId` null = Admin.
 * Customer view: internal partner names are removed from every scan text (customer-safe.ts).
 */
export async function trackingForOrder(orderId: string, orgId: string | null, opts: { customerSafe: boolean; podBase: "portal" | "admin" }): Promise<TrackShipment[]> {
  const db = await getDb();
  const ships = await db.select().from(schema.shipments)
    .where(and(eq(schema.shipments.orderId, orderId), orgId ? eq(schema.shipments.orgId, orgId) : undefined, ne(schema.shipments.bookingStatus, "failed")))
    .orderBy(asc(schema.shipments.createdAt));
  if (!ships.length) return [];
  const events = await db.select().from(schema.shipmentEvents).where(inArray(schema.shipmentEvents.shipmentId, ships.map((s) => s.id))).orderBy(asc(schema.shipmentEvents.occurredAt));
  const clean = opts.customerSafe ? (s: string) => hideProviders(s) : undefined;
  const out: TrackShipment[] = [];
  for (const s of ships) {
    const ev = events.filter((e) => e.shipmentId === s.id);
    const pod = await podView(s.id, orgId);
    out.push({
      id: s.id, awb: s.awb, carrierName: clean ? clean(s.carrierName) : s.carrierName, statusLabel: statusLabel(s.status),
      milestones: buildMilestones(ev, s.status, s.createdAt), scans: buildScans(ev, clean),
      pod: pod ? { ...pod, href: `/api/${opts.podBase}/shipments/${s.id}/pod` } : null,
    });
  }
  return out;
}
