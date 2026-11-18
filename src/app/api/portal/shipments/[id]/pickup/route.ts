import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { apiCustomer } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db/client";
import { apiError, parseJson } from "@/server/http";
import { adapterFor, providerContext } from "@/server/providers/registry";
import { noteCapability } from "@/server/carriers/verification";
import { pickupBlockedByCod } from "@/server/whatsapp/service";

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
  const [row] = await db.select({ s: schema.shipments, o: schema.orders }).from(schema.shipments).innerJoin(schema.orders, eq(schema.orders.id, schema.shipments.orderId)).where(and(eq(schema.shipments.id, id), eq(schema.shipments.orgId, s.orgId)));
  if (!row) return apiError(404, "not_found", "Shipment not found");
  const sh = row.s;
  if (sh.bookingStatus !== "confirmed") return apiError(409, "conflict", "The courier has not confirmed this booking yet");
  if (!["booked", "pickup_pending"].includes(sh.status)) return apiError(409, "conflict", `Shipment is already ${sh.status.replace(/_/g, " ")}`);
  const codHold = await pickupBlockedByCod(row.o.id);
  if (codHold) return apiError(409, "conflict", codHold);
  if (sh.pickupRef && sh.pickupDate && sh.pickupDate.toISOString().slice(0, 10) === p.data.date) return NextResponse.json({ ok: true, pickupRef: sh.pickupRef, date: p.data.date, duplicate: true });
  const [acct] = await db.select().from(schema.providerAccounts).where(eq(schema.providerAccounts.id, sh.providerAccountId));
  const ad = acct && adapterFor(acct);
  if (!ad || !ad.implemented.includes("pickup")) return apiError(422, "validation_error", "This courier does not accept pickup requests through Vishwaship");
  const [sync] = row.o.warehouseId ? await db.select().from(schema.warehouseProviderSync).where(and(eq(schema.warehouseProviderSync.warehouseId, row.o.warehouseId), eq(schema.warehouseProviderSync.providerAccountId, acct.id))) : [];
  const boxes = (await db.select().from(schema.packages).where(eq(schema.packages.orderId, row.o.id))).reduce((t, x) => t + x.count, 0);
  const r = await ad.schedulePickup(await providerContext(acct), { providerOrderRef: sh.providerOrderRef ?? sh.id, awb: sh.awb ?? "", pickupLocation: sync?.providerWarehouseRef ?? undefined, packageCount: boxes || 1 }, p.data.date);
  await audit({ actorUserId: s.userId, actorKind: s.impersonatorId ? "staff" : "customer", orgId: s.orgId, action: r.ok ? "pickup.requested" : "pickup.failed", targetType: "order", targetId: row.o.id, details: { date: p.data.date, error: r.ok ? undefined : r.error.message } });
  if (!r.ok) return apiError(502, "provider_error", r.error.message);
  await noteCapability(acct.id, "pickup", true, { evidence: `pickup ${r.value.pickupRef ?? p.data.date}` });
  await db.update(schema.shipments).set({ pickupStatus: "scheduled", pickupRef: r.value.pickupRef ?? null, pickupDate: new Date(`${p.data.date}T12:00:00+05:30`), status: sh.status === "booked" ? "pickup_pending" : sh.status }).where(eq(schema.shipments.id, sh.id));
  return NextResponse.json({ ok: true, pickupRef: r.value.pickupRef, date: p.data.date });
}
