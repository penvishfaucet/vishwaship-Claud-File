import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { timeline } from "./service";
import { toBuyerEvents, type BuyerShipment } from "@/components/public/BuyerTracking";

/** Look up a shipment by its unguessable public reference and return buyer-safe fields only. */
export async function buyerShipmentByRef(ref: string): Promise<{ orgId: string; shipment: BuyerShipment } | null> {
  if (!/^t[A-Za-z0-9_-]{10,40}$/.test(ref)) return null;
  const db = await getDb();
  const [row] = await db.select({ s: schema.shipments, o: schema.orders }).from(schema.shipments)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.shipments.orderId)).where(eq(schema.shipments.publicRef, ref));
  if (!row) return null;
  const ev = await timeline(row.s.id);
  return {
    orgId: row.s.orgId,
    shipment: {
      orderNumber: row.o.orderNumber, awb: row.s.awb, carrierCode: row.s.carrierCode, carrierName: row.s.carrierName,
      status: row.s.status, etaDate: row.s.etaDate?.toISOString() ?? null, events: toBuyerEvents(ev),
    },
  };
}
