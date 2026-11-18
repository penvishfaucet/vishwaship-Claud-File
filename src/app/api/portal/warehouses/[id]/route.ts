import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { apiCustomer } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db/client";
import { hasFeature } from "@/server/features";
import { apiError, parseJson } from "@/server/http";
import { enqueue } from "@/server/jobs/runner";
import { WarehouseInput, getOwnWarehouse, pickupOtpRequired, setDefaultWarehouse } from "@/server/warehouses";

/** Edit. Changing the pickup mobile resets OTP verification. Past orders keep their own address snapshot. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  if (!(await hasFeature(s.orgId, "warehouses"))) return apiError(403, "forbidden", "Warehouses are not enabled for your account");
  const w = await getOwnWarehouse(s.orgId, (await params).id);
  if (!w) return apiError(404, "not_found", "Warehouse not found");
  const p = await parseJson(req, WarehouseInput);
  if (!p.ok) return p.res;
  const mobileChanged = p.data.mobile !== w.mobile;
  const db = await getDb();
  await db.update(schema.warehouses).set({
    ...p.data, email: p.data.email || null, line2: p.data.line2 || null, updatedAt: new Date(),
    ...(mobileChanged ? { mobileVerifiedAt: null } : {}),
  }).where(eq(schema.warehouses.id, w.id));
  // Courier-side registrations must be re-synced after an address change.
  await db.update(schema.warehouseProviderSync).set({ status: "pending", updatedAt: new Date() }).where(eq(schema.warehouseProviderSync.warehouseId, w.id));
  await audit({ actorUserId: s.userId, actorKind: s.impersonatorId ? "staff" : "customer", orgId: s.orgId, action: "warehouse.update", targetType: "warehouse", targetId: w.id, details: { mobileChanged } });
  await enqueue("warehouse.sync", { warehouseId: w.id }, { dedupeKey: `warehouse.sync:${w.id}:${Date.now()}` }); // re-register the edited address
  return NextResponse.json({ ok: true, mobileChanged, otpRequired: await pickupOtpRequired() });
}

const Action = z.object({ action: z.enum(["set_default", "deactivate", "activate"]) });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const w = await getOwnWarehouse(s.orgId, (await params).id);
  if (!w) return apiError(404, "not_found", "Warehouse not found");
  const p = await parseJson(req, Action);
  if (!p.ok) return p.res;
  const db = await getDb();
  if (p.data.action === "set_default") {
    if (!w.active) return apiError(409, "conflict", "Activate this warehouse before making it the default");
    await setDefaultWarehouse(s.orgId, w.id);
  } else if (p.data.action === "deactivate") {
    const active = await db.select({ id: schema.warehouses.id }).from(schema.warehouses).where(and(eq(schema.warehouses.orgId, s.orgId), eq(schema.warehouses.active, true)));
    if (active.length <= 1) return apiError(409, "conflict", "Keep at least one active pickup address");
    await db.update(schema.warehouses).set({ active: false, isDefault: false, deactivatedAt: new Date(), updatedAt: new Date() }).where(eq(schema.warehouses.id, w.id));
    if (w.isDefault) {
      const [next] = await db.select().from(schema.warehouses).where(and(eq(schema.warehouses.orgId, s.orgId), eq(schema.warehouses.active, true))).limit(1);
      if (next) await setDefaultWarehouse(s.orgId, next.id);
    }
  } else {
    await db.update(schema.warehouses).set({ active: true, deactivatedAt: null, updatedAt: new Date() }).where(eq(schema.warehouses.id, w.id));
  }
  await audit({ actorUserId: s.userId, actorKind: s.impersonatorId ? "staff" : "customer", orgId: s.orgId, action: `warehouse.${p.data.action}`, targetType: "warehouse", targetId: w.id });
  return NextResponse.json({ ok: true });
}
