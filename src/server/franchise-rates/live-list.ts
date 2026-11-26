import "server-only";
import { eq } from "drizzle-orm";
import { FRANCHISE_ZONES } from "@/lib/franchise-rates";
import { getDb, schema } from "@/server/db/client";
import { toQuoteRequest } from "@/server/quotes/input";
import { getQuotes } from "@/server/quotes/service";
import { getFranchiseRateSettings } from "./settings";

/**
 * Zone-wise price list built from LIVE courier rates: for each zone and weight, the cheapest B2C prepaid
 * offer from the active courier services (same pricing as the public calculator, before the franchise
 * margin). Cached in pricing_settings and refreshed in the background once a day, so the page stays fast.
 */
export const LIVE_ORIGIN = { pin: "110034", city: "Delhi" };
export const LIVE_ROUTES: Record<string, { pin: string; city: string }> = {
  A: { pin: "110001", city: "Delhi" },
  B: { pin: "122001", city: "Gurugram" },
  C: { pin: "400001", city: "Mumbai" },
  D: { pin: "641001", city: "Coimbatore" },
  E: { pin: "781001", city: "Guwahati" },
};
export const LIVE_WEIGHTS = [0.5, 1, 2, 3, 5];

export interface LiveCell { carrierName: string; serviceName: string; lines: Array<{ code: string; label: string; sellPreTax: number }>; sellingSubtotal: number; gst: number; total: number }
export interface LivePriceList { updatedAt: string; marginBps?: number; cells: Record<string, Array<LiveCell | null>> }

// v2: priced at courier cost + franchise margin (v1 added the margin on top of the public price)
const KEY = "franchise_live_price_list_v2";
// "all" = with Shipora X rates too (personal links that include them); the standard list never has them
const keyFor = (all: boolean) => (all ? `${KEY}_all` : KEY);
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const g = globalThis as unknown as { __frLiveRefresh?: Record<string, Promise<void> | null> };
const running = () => (g.__frLiveRefresh ??= {});

export async function readLivePriceList(all = false): Promise<LivePriceList | null> {
  try {
    const db = await getDb();
    const [row] = await db.select().from(schema.pricingSettings).where(eq(schema.pricingSettings.key, keyFor(all)));
    const v = row?.value as LivePriceList | undefined;
    return v && typeof v.updatedAt === "string" && v.cells ? v : null;
  } catch {
    return null;
  }
}

async function cheapest(destination: string, weightKg: number, marginBps: number, all: boolean): Promise<LiveCell | null> {
  const req = toQuoteRequest({
    mode: "B2C", originPincode: LIVE_ORIGIN.pin, destinationPincode: destination, paymentType: "prepaid",
    codAmountRupees: 0, declaredValueRupees: 1000,
    packages: [{ count: 1, lengthCm: 10, breadthCm: 10, heightCm: 10, weightKg }],
  });
  const { offers } = await getQuotes(req, null, { persist: false, markupBps: marginBps, includeRestricted: all });
  const best = offers.filter((o) => !o.isDemo && o.total > 0).sort((a, b) => a.sellingSubtotal - b.sellingSubtotal)[0];
  if (!best) return null;
  return {
    carrierName: best.carrierName, serviceName: best.serviceName,
    lines: best.lines.map((l) => ({ code: l.code, label: l.label, sellPreTax: l.sellPreTax })),
    sellingSubtotal: best.sellingSubtotal, gst: best.gst, total: best.total,
  };
}

/** Fetch every zone × weight from the live courier services (3 at a time) and save. */
export async function refreshLivePriceList(all = false): Promise<LivePriceList> {
  const jobs = FRANCHISE_ZONES.flatMap((z) => LIVE_WEIGHTS.map((w, wi) => ({ zone: z.code, wi, w })));
  const { marginBps } = await getFranchiseRateSettings();
  const cells: LivePriceList["cells"] = Object.fromEntries(FRANCHISE_ZONES.map((z) => [z.code, LIVE_WEIGHTS.map(() => null)]));
  for (let i = 0; i < jobs.length; i += 3) {
    await Promise.all(jobs.slice(i, i + 3).map(async (j) => {
      try { cells[j.zone][j.wi] = await cheapest(LIVE_ROUTES[j.zone].pin, j.w, marginBps, all); }
      catch (e) { console.error("[franchise-live-list]", j.zone, j.w, (e as Error).message); }
    }));
  }
  const prev = await readLivePriceList(all);
  const filled = Object.values(cells).flat().filter(Boolean).length;
  // A failed run (all couriers unreachable) must not wipe a good list.
  if (!filled && prev) return prev;
  const list: LivePriceList = { updatedAt: new Date().toISOString(), marginBps, cells };
  const db = await getDb();
  await db.insert(schema.pricingSettings).values({ key: keyFor(all), value: list })
    .onConflictDoUpdate({ target: schema.pricingSettings.key, set: { value: list, updatedAt: new Date() } });
  return list;
}

/** Start one background refresh (no-op if one is already running). */
export function startLiveRefresh(all = false) {
  const k = keyFor(all), r = running();
  if (r[k]) return;
  r[k] = refreshLivePriceList(all).then(() => undefined, (e) => console.error("[franchise-live-list]", (e as Error).message)).finally(() => { r[k] = null; });
}

export const isLiveRefreshing = (all = false) => !!running()[keyFor(all)];

/** The cached list; starts a background refresh when it is missing or older than a day. */
export async function getLivePriceList(all = false): Promise<LivePriceList | null> {
  const list = await readLivePriceList(all);
  if (!list || Date.now() - new Date(list.updatedAt).getTime() > MAX_AGE_MS) startLiveRefresh(all);
  return list;
}
