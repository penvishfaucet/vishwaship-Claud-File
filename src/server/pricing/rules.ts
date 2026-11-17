import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { audit } from "@/server/audit";
import { newId } from "@/server/util/ids";

/**
 * Versioned markup rules. A change never edits an existing row: it clears the active row and
 * inserts a new version, so saved quotes keep the rule they were priced with.
 */
async function nextVersion(provider: string, orgId: string | null) {
  const db = await getDb();
  const [last] = await db.select().from(schema.markupRules)
    .where(and(eq(schema.markupRules.provider, provider), orgId ? eq(schema.markupRules.orgId, orgId) : isNull(schema.markupRules.orgId)))
    .orderBy(desc(schema.markupRules.version)).limit(1);
  return (last?.version ?? 0) + 1;
}

async function clearActive(provider: string, orgId: string | null) {
  const db = await getDb();
  await db.update(schema.markupRules).set({ clearedAt: new Date() })
    .where(and(eq(schema.markupRules.provider, provider), orgId ? eq(schema.markupRules.orgId, orgId) : isNull(schema.markupRules.orgId), isNull(schema.markupRules.clearedAt)));
}

export async function setMarkup(provider: string, orgId: string | null, bps: number, actorUserId: string) {
  if (!Number.isInteger(bps) || bps < 0 || bps > 50_000) throw new Error("Markup must be between 0% and 500%");
  const db = await getDb();
  const version = await nextVersion(provider, orgId);
  await clearActive(provider, orgId);
  const id = newId("mk");
  await db.insert(schema.markupRules).values({ id, provider, orgId, bps, version, effectiveFrom: new Date(), createdBy: actorUserId });
  await audit({ actorUserId, actorKind: "staff", orgId, action: orgId ? "pricing.override_set" : "pricing.global_set", targetType: "markup_rule", targetId: id, details: { provider, bps, version } });
  return { id, version };
}

export async function clearOverride(provider: string, orgId: string, actorUserId: string) {
  await clearActive(provider, orgId);
  await audit({ actorUserId, actorKind: "staff", orgId, action: "pricing.override_cleared", details: { provider } });
}
