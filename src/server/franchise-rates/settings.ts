import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { audit } from "@/server/audit";
import { type CardService, DEFAULT_FRANCHISE_CARD, DEFAULT_FRANCHISE_MARGIN_BPS } from "@/lib/franchise-rates";

/** Franchise Rate List settings, stored in pricing_settings (no schema change). */
export interface FranchiseRateSettings { marginBps: number; card: CardService[] }

const KEY = "franchise_rate_list";

function valid(v: unknown): v is FranchiseRateSettings {
  const s = v as FranchiseRateSettings;
  return !!s && Number.isInteger(s.marginBps) && s.marginBps >= 0 && s.marginBps <= 10_000 && Array.isArray(s.card) &&
    s.card.every((c) => typeof c.name === "string" && c.first500Paise?.length === 5 && c.addl500Paise?.length === 5 &&
      [...c.first500Paise, ...c.addl500Paise].every((p) => Number.isSafeInteger(p) && p >= 0));
}

export async function getFranchiseRateSettings(): Promise<FranchiseRateSettings> {
  const fallback = { marginBps: DEFAULT_FRANCHISE_MARGIN_BPS, card: DEFAULT_FRANCHISE_CARD };
  try {
    const db = await getDb();
    const [row] = await db.select().from(schema.pricingSettings).where(eq(schema.pricingSettings.key, KEY));
    return valid(row?.value) ? row.value : fallback;
  } catch {
    return fallback;
  }
}

export async function saveFranchiseRateSettings(next: FranchiseRateSettings, actorUserId: string) {
  if (!valid(next)) throw new Error("Invalid franchise rate settings");
  const db = await getDb();
  await db.insert(schema.pricingSettings).values({ key: KEY, value: next })
    .onConflictDoUpdate({ target: schema.pricingSettings.key, set: { value: next, updatedAt: new Date() } });
  await audit({ actorUserId, actorKind: "staff", action: "franchise_rate_list.updated", targetType: "setting", targetId: KEY, details: { marginBps: next.marginBps } });
}
