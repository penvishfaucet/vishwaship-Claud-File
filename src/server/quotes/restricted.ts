import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";

/**
 * Restricted courier services (owner 2026-11-26): Shipora X rates are offered only to customers the owner switches on
 * (bulk clients), and on personal Franchise Rate List links that include them. Everyone else — the public
 * calculators, the standard Franchise Rate List and every other customer — never sees or books them.
 * Switched per customer in Admin → Customers → (customer) → Pricing.
 */
export const RESTRICTED_ADAPTERS = ["shiporax"];
export const SHIPORA_ACCESS_KEY = "shipora_access";

export async function shiporaOrgIds(): Promise<string[]> {
  const db = await getDb();
  const [row] = await db.select().from(schema.pricingSettings).where(eq(schema.pricingSettings.key, SHIPORA_ACCESS_KEY));
  const v = (row?.value as { orgIds?: unknown } | undefined)?.orgIds;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

export async function setShiporaAccess(orgId: string, on: boolean) {
  const ids = new Set(await shiporaOrgIds());
  if (on) ids.add(orgId); else ids.delete(orgId);
  const value = { orgIds: [...ids] };
  const db = await getDb();
  await db.insert(schema.pricingSettings).values({ key: SHIPORA_ACCESS_KEY, value })
    .onConflictDoUpdate({ target: schema.pricingSettings.key, set: { value, updatedAt: new Date() } });
}
