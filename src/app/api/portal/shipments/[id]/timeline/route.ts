import { hideProviders } from "@/server/customer-safe";
import { NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { apiCustomer } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { hasFeature } from "@/server/features";
import { apiError } from "@/server/http";
import { timeline } from "@/server/tracking/service";

/** Tracking timeline for the Track dialog (own shipments only). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  if (!(await hasFeature(s.orgId, "tracking"))) return apiError(403, "forbidden", "Tracking is not enabled for your account");
  const { id } = await params;
  const db = await getDb();
  const [sh] = await db.select().from(schema.shipments).where(and(eq(schema.shipments.id, id), eq(schema.shipments.orgId, s.orgId)));
  if (!sh) return apiError(404, "not_found", "Shipment not found");
  const [o] = await db.select({ orderNumber: schema.orders.orderNumber, consignee: schema.orders.consignee }).from(schema.orders).where(eq(schema.orders.id, sh.orderId));
  const events = await timeline(id);
  const amendments = await db.select().from(schema.destinationAmendments).where(eq(schema.destinationAmendments.shipmentId, id)).orderBy(desc(schema.destinationAmendments.occurredAt));
  const c = o.consignee as { city?: string; state?: string; pincode?: string };
  return NextResponse.json({
    orderNumber: o.orderNumber, carrier: sh.carrierName, service: sh.serviceName, awb: sh.awb, lr: sh.lrNumber && sh.lrNumber !== sh.awb ? sh.lrNumber : null,
    status: sh.status, etaDate: sh.etaDate,
    pickup: { status: sh.pickupStatus, date: sh.pickupDate, requestId: sh.pickupRequestId, agentName: sh.pickupAgentName, agentPhone: sh.pickupAgentPhone },
    delivery: deliveryAgent(events), deliveredAt: sh.deliveredAt, lastLocation: sh.lastLocation, lastEventAt: sh.lastEventAt,
    lastSyncAt: sh.lastSyncAt, lastSyncError: sh.lastSyncError ? hideProviders(sh.lastSyncError) : null, syncFailures: sh.syncFailures, demo: sh.provider === "demo",
    destination: { city: c.city, state: c.state, pincode: c.pincode },
    events: events.slice().reverse().map((e) => ({ status: e.status, raw: e.rawStatus, location: e.location, at: e.occurredAt, remark: e.remark, source: e.source })),
    amendments: amendments.map((a) => ({ at: a.occurredAt, previous: addr(a.previous), next: addr(a.next) })),
  });
}
/** Delivery executive, when the courier puts a name / phone in an out-for-delivery scan remark. */
function deliveryAgent(events: Array<{ status: string; remark: string | null; rawStatus: string | null }>) {
  for (const e of events.slice().reverse()) {
    if (e.status !== "out_for_delivery") continue;
    const t = `${e.remark ?? ""} ${e.rawStatus ?? ""}`;
    const phone = t.match(/(?:\+91[-\s]?)?([6-9]\d{9})/)?.[1] ?? null;
    const name = t.match(/(?:executive|agent|rider|boy|fe|sr)\s*(?:name)?\s*[:-]\s*([A-Za-z][A-Za-z .]{1,40})/i)?.[1]?.trim() ?? null;
    if (phone || name) return { name, phone };
  }
  return null;
}
const addr = (v: unknown) => { const a = v as Record<string, string>; return [a.line1, a.line2, a.city, a.state, a.pincode].filter(Boolean).join(", "); };
