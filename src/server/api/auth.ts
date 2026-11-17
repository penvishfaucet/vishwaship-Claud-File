import "server-only";
import { createHash } from "node:crypto";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb, schema } from "@/server/db/client";
import { sha256, safeEqual } from "@/server/security/crypto";
import { rateLimit } from "@/server/security/rate-limit";

export const API_SCOPES = ["quotes:read", "orders:read", "orders:write", "shipments:write", "tracking:read", "labels:read", "ndr:write"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export function v1Error(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/** Bearer <key_id>.<secret>; tenant comes from the key, never from the request. */
export async function apiKeyAuth(req: Request, scope: ApiScope) {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer (vsk_[A-Za-z0-9]+)\.([A-Za-z0-9_-]{20,})$/.exec(h);
  if (!m) return { ok: false as const, res: v1Error(401, "unauthorized", "Missing or malformed API key") };
  const db = await getDb();
  const [k] = await db.select().from(schema.apiKeys).where(and(eq(schema.apiKeys.id, m[1]), isNull(schema.apiKeys.revokedAt), or(isNull(schema.apiKeys.expiresAt), gt(schema.apiKeys.expiresAt, new Date()))));
  if (!k || !safeEqual(k.secretHash, sha256(m[2]))) return { ok: false as const, res: v1Error(401, "unauthorized", "Invalid API key") };
  if (!(k.scopes as string[]).includes(scope)) return { ok: false as const, res: v1Error(403, "forbidden", `Key lacks scope ${scope}`) };
  if (!k.orgId) return { ok: false as const, res: v1Error(403, "forbidden", "Service-account keys must use the admin API") };
  const rl = await rateLimit(`api:${k.id}`, 120, 60);
  if (!rl.ok) return { ok: false as const, res: NextResponse.json({ error: { code: "rate_limited", message: "Rate limit exceeded" } }, { status: 429, headers: { "retry-after": String(rl.retryAfter) } }) };
  await db.update(schema.apiKeys).set({ lastUsedAt: new Date() }).where(eq(schema.apiKeys.id, k.id));
  return { ok: true as const, orgId: k.orgId, keyId: k.id };
}

/** Idempotency for mutations: same key + same body replays the stored response; different body -> 409. */
export async function withIdempotency(req: Request, orgId: string, keyId: string, body: string, run: () => Promise<{ status: number; body: unknown }>) {
  const ik = req.headers.get("idempotency-key");
  if (!ik || ik.length > 100) return v1Error(400, "validation_error", "Idempotency-Key header is required for this request");
  const db = await getDb();
  const key = `${orgId}:${keyId}:${ik}`;
  const hash = createHash("sha256").update(body).digest("hex");
  const [prev] = await db.select().from(schema.idempotencyRecords).where(eq(schema.idempotencyRecords.key, key));
  if (prev) {
    if (prev.requestHash !== hash) return v1Error(409, "conflict", "Idempotency-Key was used with a different request body");
    if (prev.responseStatus) return NextResponse.json(prev.responseBody, { status: prev.responseStatus, headers: { "idempotent-replay": "true" } });
    return v1Error(409, "conflict", "A request with this Idempotency-Key is still in progress");
  }
  await db.insert(schema.idempotencyRecords).values({ key, requestHash: hash });
  const out = await run();
  await db.update(schema.idempotencyRecords).set({ responseStatus: out.status, responseBody: out.body as object }).where(eq(schema.idempotencyRecords.key, key));
  return NextResponse.json(out.body, { status: out.status });
}
