import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { apiCustomer } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db/client";
import { hasFeature } from "@/server/features";
import { apiError, parseJson } from "@/server/http";
import { newId } from "@/server/util/ids";
import { enqueue } from "@/server/jobs/runner";
import { PICKUP_OTP_MSG, WarehouseInput, checkPickupMobileToken, nextWarehouseCode, pickupOtpRequired } from "@/server/warehouses";
import { z } from "zod";

export async function POST(req: Request) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  if (!(await hasFeature(s.orgId, "warehouses"))) return apiError(403, "forbidden", "Warehouses are not enabled for your account");
  const p = await parseJson(req, WarehouseInput.extend({ mobileToken: z.string().max(4096).optional() }));
  if (!p.ok) return p.res;
  const { mobileToken, ...data } = p.data;
  // the pickup mobile is OTP-verified before the address is saved (Vishwaship staff acting for a customer may skip it)
  const otp = await checkPickupMobileToken(mobileToken, data.mobile);
  if (otp !== "off" && otp !== "ok" && !(s.impersonatorId && otp === "missing")) return apiError(422, "validation_error", PICKUP_OTP_MSG[otp]);
  const db = await getDb();
  const existing = await db.select({ id: schema.warehouses.id }).from(schema.warehouses).where(eq(schema.warehouses.orgId, s.orgId));
  const id = newId("wh");
  await db.insert(schema.warehouses).values({
    id, orgId: s.orgId, ...data, email: data.email || null, line2: data.line2 || null, ...(otp === "ok" ? { mobileVerifiedAt: new Date() } : {}),
    isDefault: existing.length === 0, code: await nextWarehouseCode(), createdBy: s.name,
  });
  await audit({ actorUserId: s.userId, actorKind: s.impersonatorId ? "staff" : "customer", orgId: s.orgId, action: "warehouse.create", targetType: "warehouse", targetId: id, details: s.impersonatorId ? { viaAdmin: s.impersonatorId } : undefined });
  // Register the new pickup address with every courier the customer can book (Shipmozo, Delhivery, Shipora X …).
  await enqueue("warehouse.sync", { warehouseId: id }, { dedupeKey: `warehouse.sync:${id}:0` });
  return NextResponse.json({ id, verified: otp === "ok", otpRequired: await pickupOtpRequired() }, { status: 201 });
}
