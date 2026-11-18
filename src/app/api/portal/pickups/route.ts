import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { apiCustomer } from "@/server/auth/session";
import { generatePickupRequest } from "@/server/carriers/automation";
import { hideProviders } from "@/server/customer-safe";
import { getDb, schema } from "@/server/db/client";
import { apiError, parseJson } from "@/server/http";

/** Generate a pickup request (PR) for selected shipments of one pickup address and date. */
export async function POST(req: Request) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const p = await parseJson(req, z.object({ warehouseId: z.string().min(3), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a pickup date"), shipmentIds: z.array(z.string().min(3)).min(1, "Select at least one shipment").max(200) }));
  if (!p.ok) return p.res;
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  if (p.data.date < today) return apiError(422, "validation_error", "Pickup date cannot be in the past");
  const db = await getDb();
  const [wh] = await db.select({ id: schema.warehouses.id }).from(schema.warehouses).where(and(eq(schema.warehouses.id, p.data.warehouseId), eq(schema.warehouses.orgId, s.orgId)));
  if (!wh) return apiError(404, "not_found", "Pickup address not found");
  const results = await generatePickupRequest({ orgId: s.orgId, warehouseId: wh.id, date: p.data.date, shipmentIds: p.data.shipmentIds, actor: { userId: s.userId, kind: s.impersonatorId ? "staff" : "customer" } });
  return NextResponse.json({ results: results.map((r) => ({ ...r, message: hideProviders(r.message) })) });
}
