import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { apiCustomer } from "@/server/auth/session";
import { requestPickup } from "@/server/carriers/automation";
import { getDb, schema } from "@/server/db/client";
import { apiError, parseJson } from "@/server/http";

/** Request a courier pickup for a booked shipment. One request per shipment + date (retries return the same reference). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const p = await parseJson(req, z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a pickup date") }));
  if (!p.ok) return p.res;
  const { id } = await params;
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  if (p.data.date < today) return apiError(422, "validation_error", "Pickup date cannot be in the past");
  const db = await getDb();
  const [own] = await db.select({ id: schema.shipments.id }).from(schema.shipments).where(and(eq(schema.shipments.id, id), eq(schema.shipments.orgId, s.orgId)));
  if (!own) return apiError(404, "not_found", "Shipment not found");
  const r = await requestPickup(own.id, p.data.date, { userId: s.userId, kind: s.impersonatorId ? "staff" : "customer" });
  if (!r.ok) return apiError(r.retry ? 502 : 409, r.retry ? "provider_error" : "conflict", r.message);
  return NextResponse.json({ ok: true, pickupRef: r.pickupRef, date: r.date, duplicate: r.duplicate ?? false });
}
