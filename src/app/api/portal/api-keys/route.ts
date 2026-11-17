import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { apiCustomer } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db/client";
import { apiError, parseJson } from "@/server/http";
import { sha256 } from "@/server/security/crypto";
import { randomToken } from "@/server/util/ids";
import { API_SCOPES } from "@/server/api/auth";

export async function POST(req: Request) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const p = await parseJson(req, z.object({ label: z.string().trim().min(2).max(60), scopes: z.array(z.enum(API_SCOPES)).min(1), expiresInDays: z.number().int().min(1).max(730).optional() }));
  if (!p.ok) return p.res;
  const id = `vsk_${randomToken(9).replace(/[^a-z0-9]/gi, "")}`;
  const secret = randomToken(32);
  const db = await getDb();
  await db.insert(schema.apiKeys).values({ id, orgId: s.orgId, label: p.data.label, secretHash: sha256(secret), scopes: p.data.scopes, createdBy: s.userId, expiresAt: p.data.expiresInDays ? new Date(Date.now() + p.data.expiresInDays * 86400_000) : null });
  await audit({ actorUserId: s.userId, actorKind: "customer", orgId: s.orgId, action: "api_key.create", targetType: "api_key", targetId: id, details: { scopes: p.data.scopes } });
  return NextResponse.json({ id, secret }, { status: 201 });
}

export async function DELETE(req: Request) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const id = new URL(req.url).searchParams.get("id") ?? "";
  const db = await getDb();
  const r = await db.update(schema.apiKeys).set({ revokedAt: new Date() }).where(and(eq(schema.apiKeys.id, id), eq(schema.apiKeys.orgId, s.orgId))).returning({ id: schema.apiKeys.id });
  if (!r.length) return apiError(404, "not_found", "Key not found");
  await audit({ actorUserId: s.userId, actorKind: "customer", orgId: s.orgId, action: "api_key.revoke", targetType: "api_key", targetId: id });
  return NextResponse.json({ ok: true });
}
