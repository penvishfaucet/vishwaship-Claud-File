import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { sha256 } from "@/server/security/crypto";
import { randomToken } from "@/server/util/ids";
import type { ApiScope } from "./auth";

/**
 * Vishwaship API credentials (for /api/v1). Key ID is public; the secret is shown ONCE and only its
 * SHA-256 hash is stored. Callers send:  Authorization: Bearer <key_id>.<secret>
 * Every key belongs to one customer workspace (orgId) — that is the tenant the API acts for.
 */
const newSecret = () => randomToken(32);

export async function createApiKey(a: { orgId: string; label: string; scopes: ApiScope[]; expiresInDays?: number; createdBy: string }) {
  const id = `vsk_${randomBytes(8).toString("hex")}`; // always 16 hex chars
  const secret = newSecret();
  const db = await getDb();
  await db.insert(schema.apiKeys).values({
    id, orgId: a.orgId, label: a.label, secretHash: sha256(secret), scopes: a.scopes, createdBy: a.createdBy,
    expiresAt: a.expiresInDays ? new Date(Date.now() + a.expiresInDays * 86400_000) : null,
  });
  return { id, secret };
}

/** Rotate: issue a new secret for the same key ID; the old secret stops working immediately. */
export async function rotateApiKey(id: string, orgId?: string) {
  const secret = newSecret();
  const db = await getDb();
  const where = orgId ? and(eq(schema.apiKeys.id, id), eq(schema.apiKeys.orgId, orgId)) : eq(schema.apiKeys.id, id);
  const [k] = await db.select().from(schema.apiKeys).where(where);
  if (!k || k.revokedAt) return null;
  await db.update(schema.apiKeys).set({ secretHash: sha256(secret) }).where(eq(schema.apiKeys.id, id));
  return { id, secret };
}

export async function revokeApiKey(id: string, orgId?: string) {
  const db = await getDb();
  const where = orgId ? and(eq(schema.apiKeys.id, id), eq(schema.apiKeys.orgId, orgId)) : eq(schema.apiKeys.id, id);
  const r = await db.update(schema.apiKeys).set({ revokedAt: new Date() }).where(where).returning({ id: schema.apiKeys.id, orgId: schema.apiKeys.orgId });
  return r[0] ?? null;
}
