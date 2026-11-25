import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { getSetting } from "@/server/quotes/service";
import { FREE_TRIAL_DEFAULTS, type FreeTrialConfig, freeTrialWindow, inFreeTrial } from "@/lib/free-trial";

export { FREE_TRIAL_DEFAULTS, type FreeTrialConfig } from "@/lib/free-trial";

/** Admin can change the offer (Admin → Plans & Features → Free first month). */
export async function freeTrialConfig(): Promise<FreeTrialConfig> {
  const v = (await getSetting<Partial<FreeTrialConfig>>("free_trial", FREE_TRIAL_DEFAULTS)).value;
  return { ...FREE_TRIAL_DEFAULTS, ...v };
}

async function orgCreatedAt(orgId: string): Promise<Date | null> {
  const db = await getDb();
  const [o] = await db.select({ c: schema.orgs.createdAt }).from(schema.orgs).where(eq(schema.orgs.id, orgId));
  return o?.c ?? null;
}

/** Is this client inside the free first month (at `at`, default now)? */
export async function orgInFreeTrial(orgId: string, at = new Date()): Promise<boolean> {
  const [cfg, created] = await Promise.all([freeTrialConfig(), orgCreatedAt(orgId)]);
  return !!created && inFreeTrial(cfg, created, at);
}

/** The client's free window (for banners), or null when the offer is off. */
export async function orgFreeTrialWindow(orgId: string) {
  const [cfg, created] = await Promise.all([freeTrialConfig(), orgCreatedAt(orgId)]);
  return created ? freeTrialWindow(cfg, created) : null;
}
