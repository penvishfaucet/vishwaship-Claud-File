import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { apiCustomer } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db/client";
import { hasFeature } from "@/server/features";
import { apiError, parseJson } from "@/server/http";
import { newId } from "@/server/util/ids";
import { WarehouseInput, nextWarehouseCode } from "@/server/warehouses";

export async function POST(req: Request) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  if (!(await hasFeature(s.orgId, "warehouses"))) return apiError(403, "forbidden", "Warehouses are not enabled for your account");
  const p = await parseJson(req, WarehouseInput);
  if (!p.ok) return p.res;
  const db = await getDb();
  const existing = await db.select({ id: schema.warehouses.id }).from(schema.warehouses).where(eq(schema.warehouses.orgId, s.orgId));
  const id = newId("wh");
  await db.insert(schema.warehouses).values({
    id, orgId: s.orgId, ...p.data, email: p.data.email || null, line2: p.data.line2 || null,
    isDefault: existing.length === 0, code: await nextWarehouseCode(), createdBy: s.name,
  });
  await audit({ actorUserId: s.userId, actorKind: s.impersonatorId ? "staff" : "customer", orgId: s.orgId, action: "warehouse.create", targetType: "warehouse", targetId: id, details: s.impersonatorId ? { viaAdmin: s.impersonatorId } : undefined });
  return NextResponse.json({ id }, { status: 201 });
}
