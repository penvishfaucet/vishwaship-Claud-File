import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { getSetting } from "@/server/quotes/service";

/** Admin: couriers switched off for everyone (carrier codes). */
export async function courierAvailability() {
  return (await getSetting<{ disabled: string[] }>("courier_availability", { disabled: [] })).value;
}

export interface CourierPrefs { disabled: string[]; priority: string[] }

/** Customer: couriers they do not want offered, and their preference order (used by auto-assign). */
export async function courierPrefs(orgId: string): Promise<CourierPrefs> {
  const s = await orgSetting<CourierPrefs>(orgId, "courier_prefs");
  return { disabled: s?.disabled ?? [], priority: s?.priority ?? [] };
}

export async function orgSetting<T>(orgId: string, key: string): Promise<T | null> {
  const db = await getDb();
  const [r] = await db.select().from(schema.orgSettings).where(and(eq(schema.orgSettings.orgId, orgId), eq(schema.orgSettings.key, key)));
  return (r?.value as T) ?? null;
}

export async function saveOrgSetting(orgId: string, key: string, value: unknown, userId?: string) {
  const db = await getDb();
  await db.insert(schema.orgSettings).values({ orgId, key, value, updatedBy: userId ?? null })
    .onConflictDoUpdate({ target: [schema.orgSettings.orgId, schema.orgSettings.key], set: { value, updatedBy: userId ?? null, updatedAt: new Date() } });
}

/** Should this carrier be offered to this account? (Admin availability first, then customer choice.) */
export async function courierFilter(orgId: string | null) {
  const admin = new Set((await courierAvailability()).disabled);
  const mine = new Set(orgId ? (await courierPrefs(orgId)).disabled : []);
  return (code: string) => !admin.has(code) && !mine.has(code);
}
