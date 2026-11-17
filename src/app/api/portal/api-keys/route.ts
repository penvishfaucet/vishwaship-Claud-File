import { NextResponse } from "next/server";
import { hasFeature } from "@/server/features";
import { z } from "zod";
import { apiCustomer } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { apiError, parseJson } from "@/server/http";
import { API_SCOPES } from "@/server/api/auth";
import { createApiKey, revokeApiKey, rotateApiKey } from "@/server/api/keys";

/** Customer's own workspace keys. The secret is returned once and never stored in plain text. */
export async function POST(req: Request) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  if (!(await hasFeature(s.orgId, "api_integration"))) return apiError(403, "forbidden", "API integration is not enabled for your account");
  if (s.impersonatorId) return apiError(403, "forbidden", "API keys can only be managed by the customer, or by the owner in Admin > API Credentials");
  const p = await parseJson(req, z.object({ label: z.string().trim().min(2).max(60), scopes: z.array(z.enum(API_SCOPES)).min(1), expiresInDays: z.number().int().min(1).max(730).optional() }));
  if (!p.ok) return p.res;
  const k = await createApiKey({ orgId: s.orgId, ...p.data, createdBy: s.userId });
  await audit({ actorUserId: s.userId, actorKind: "customer", orgId: s.orgId, action: "api_key.create", targetType: "api_key", targetId: k.id, details: { scopes: p.data.scopes } });
  return NextResponse.json(k, { status: 201 });
}

/** Rotate: new secret for the same key ID; old secret stops working at once. */
export async function PATCH(req: Request) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  if (!(await hasFeature(s.orgId, "api_integration"))) return apiError(403, "forbidden", "API integration is not enabled for your account");
  if (s.impersonatorId) return apiError(403, "forbidden", "API keys can only be managed by the customer, or by the owner in Admin > API Credentials");
  const p = await parseJson(req, z.object({ id: z.string().min(4) }));
  if (!p.ok) return p.res;
  const k = await rotateApiKey(p.data.id, s.orgId);
  if (!k) return apiError(404, "not_found", "Active key not found");
  await audit({ actorUserId: s.userId, actorKind: "customer", orgId: s.orgId, action: "api_key.rotate", targetType: "api_key", targetId: k.id });
  return NextResponse.json(k);
}

export async function DELETE(req: Request) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  if (s.impersonatorId) return apiError(403, "forbidden", "API keys can only be managed by the customer, or by the owner in Admin > API Credentials");
  const id = new URL(req.url).searchParams.get("id") ?? "";
  const r = await revokeApiKey(id, s.orgId);
  if (!r) return apiError(404, "not_found", "Key not found");
  await audit({ actorUserId: s.userId, actorKind: "customer", orgId: s.orgId, action: "api_key.revoke", targetType: "api_key", targetId: id });
  return NextResponse.json({ ok: true });
}
