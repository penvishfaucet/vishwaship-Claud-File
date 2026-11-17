import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { apiStaff } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db/client";
import { apiError, parseJson } from "@/server/http";
import { API_SCOPES } from "@/server/api/auth";
import { createApiKey, revokeApiKey, rotateApiKey } from "@/server/api/keys";

/** Admin-issued API credentials for any customer workspace. Owner only (api_keys.manage). */
export async function POST(req: Request) {
  const s = await apiStaff("api_keys.manage");
  if (!s) return apiError(403, "forbidden", "Only the owner can manage API credentials");
  const p = await parseJson(req, z.object({ orgId: z.string().min(3), label: z.string().trim().min(2).max(60), scopes: z.array(z.enum(API_SCOPES)).min(1), expiresInDays: z.number().int().min(1).max(730).optional() }));
  if (!p.ok) return p.res;
  const db = await getDb();
  const [org] = await db.select({ id: schema.orgs.id }).from(schema.orgs).where(eq(schema.orgs.id, p.data.orgId));
  if (!org) return apiError(404, "not_found", "Customer not found");
  const k = await createApiKey({ ...p.data, createdBy: s.userId });
  await audit({ actorUserId: s.userId, actorKind: "staff", orgId: p.data.orgId, action: "api_key.create", targetType: "api_key", targetId: k.id, details: { scopes: p.data.scopes, issuedBy: "admin" } });
  return NextResponse.json(k, { status: 201 });
}

export async function PATCH(req: Request) {
  const s = await apiStaff("api_keys.manage");
  if (!s) return apiError(403, "forbidden", "Only the owner can manage API credentials");
  const p = await parseJson(req, z.object({ id: z.string().min(4) }));
  if (!p.ok) return p.res;
  const k = await rotateApiKey(p.data.id);
  if (!k) return apiError(404, "not_found", "Active key not found");
  await audit({ actorUserId: s.userId, actorKind: "staff", action: "api_key.rotate", targetType: "api_key", targetId: k.id });
  return NextResponse.json(k);
}

export async function DELETE(req: Request) {
  const s = await apiStaff("api_keys.manage");
  if (!s) return apiError(403, "forbidden", "Only the owner can manage API credentials");
  const id = new URL(req.url).searchParams.get("id") ?? "";
  const r = await revokeApiKey(id);
  if (!r) return apiError(404, "not_found", "Key not found");
  await audit({ actorUserId: s.userId, actorKind: "staff", orgId: r.orgId, action: "api_key.revoke", targetType: "api_key", targetId: id });
  return NextResponse.json({ ok: true });
}
