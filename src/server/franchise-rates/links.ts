import "server-only";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";

/**
 * Personal Franchise Rate List links (owner 2026-11-26): the same page, made for one firm — its name on the page —
 * and, per link, whether Shipora X rates are included. Stored in pricing_settings (no schema change).
 */
export interface RateLink { id: string; firm: string; shipora: boolean; createdAt: string }
const KEY = "franchise_rate_links";

export async function listRateLinks(): Promise<RateLink[]> {
  const db = await getDb();
  const [row] = await db.select().from(schema.pricingSettings).where(eq(schema.pricingSettings.key, KEY));
  const v = row?.value;
  return Array.isArray(v) ? (v as RateLink[]).filter((l) => l && typeof l.id === "string" && typeof l.firm === "string") : [];
}

export async function getRateLink(id: string | null | undefined): Promise<RateLink | null> {
  if (!id || !/^[a-z0-9-]{4,80}$/.test(id)) return null;
  return (await listRateLinks()).find((l) => l.id === id) ?? null;
}

async function save(list: RateLink[]) {
  const db = await getDb();
  await db.insert(schema.pricingSettings).values({ key: KEY, value: list })
    .onConflictDoUpdate({ target: schema.pricingSettings.key, set: { value: list, updatedAt: new Date() } });
}

/** URL id: the firm name as a slug plus a random part, so links cannot be guessed. */
export const linkId = (firm: string) =>
  `${firm.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "firm"}-${randomBytes(4).toString("hex")}`;

export async function createRateLink(firm: string, shipora: boolean): Promise<RateLink> {
  const link: RateLink = { id: linkId(firm), firm: firm.trim().slice(0, 80), shipora, createdAt: new Date().toISOString() };
  await save([link, ...(await listRateLinks())]);
  return link;
}

export async function updateRateLink(id: string, patch: Partial<Pick<RateLink, "shipora" | "firm">>) {
  await save((await listRateLinks()).map((l) => (l.id === id ? { ...l, ...patch } : l)));
}

export async function deleteRateLink(id: string) {
  await save((await listRateLinks()).filter((l) => l.id !== id));
}
