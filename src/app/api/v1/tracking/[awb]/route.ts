import { NextResponse } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { apiKeyAuth, v1Error } from "@/server/api/auth";
import { getDb, schema } from "@/server/db/client";

export async function GET(req: Request, { params }: { params: Promise<{ awb: string }> }) {
  const a = await apiKeyAuth(req, "tracking:read");
  if (!a.ok) return a.res;
  const { awb } = await params;
  const db = await getDb();
  const [s] = await db.select().from(schema.shipments).where(and(eq(schema.shipments.orgId, a.orgId), eq(schema.shipments.awb, awb.toUpperCase())));
  if (!s) return v1Error(404, "not_found", "Shipment not found");
  const ev = await db.select().from(schema.shipmentEvents).where(eq(schema.shipmentEvents.shipmentId, s.id)).orderBy(asc(schema.shipmentEvents.occurredAt));
  return NextResponse.json({ data: { awb: s.awb, lr_number: s.lrNumber, reference_id: s.orderId, carrier: s.carrierName, status: s.status, shipment_type: s.serviceName, eta: s.etaDate, scans: ev.map((e) => ({ status: e.status, location: e.location, at: e.occurredAt })) } });
}
