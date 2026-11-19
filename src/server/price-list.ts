import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { getQuotes, getSetting, loadMarkupSettings, nonKycRule } from "@/server/quotes/service";
import { resolveMarkup } from "@/server/pricing/engine";
import { orgSetting, saveOrgSetting } from "@/server/couriers";

/**
 * Shipment Price List: the account's own selling rates (same engine as booking — markup, GST,
 * courier availability) for sample routes per zone and standard weight slabs. Cached 12 h per account
 * because every cell is a live quote; quotes are NOT saved for booking.
 */
export const DEFAULT_ZONES = [
  { zone: "A", label: "Within city", pin: "" }, // "" = pickup PIN itself
  { zone: "B", label: "Metro to metro", pin: "400001" },
  { zone: "C", label: "Rest of India", pin: "302001" },
  { zone: "D", label: "North-East & J&K", pin: "781001" },
];
export const SLABS_GRAMS = [500, 1000, 2000, 5000, 10000];

export interface PriceRow { carrierCode: string; carrierName: string; serviceName: string; mode: string; zone: string; cells: Record<number, number | null>; codFee: number | null; eta: number | null }
export interface PriceList { generatedAt: string; origin: string; zones: typeof DEFAULT_ZONES; rows: PriceRow[]; markupPct: number; personalized: boolean; effectiveFrom: string | null; gstPct: number; nonKyc?: boolean }

export async function priceList(orgId: string, refresh = false): Promise<PriceList | { error: string }> {
  const cached = await orgSetting<PriceList>(orgId, "price_list_cache");
  const nonKyc = await nonKycRule(orgId);
  // the margin changes when KYC is approved: a list cached under the other margin is rebuilt
  if (!refresh && cached && Date.now() - new Date(cached.generatedAt).getTime() < 12 * 3600_000 && !!cached.nonKyc === !!nonKyc) return cached;
  const db = await getDb();
  const [wh] = await db.select().from(schema.warehouses).where(and(eq(schema.warehouses.orgId, orgId), eq(schema.warehouses.active, true), eq(schema.warehouses.isDefault, true)));
  const [anyWh] = wh ? [wh] : await db.select().from(schema.warehouses).where(and(eq(schema.warehouses.orgId, orgId), eq(schema.warehouses.active, true)));
  if (!anyWh) return { error: "Add a pickup warehouse first — rates depend on where you ship from." };
  const zones = (await getSetting("price_list_zones", DEFAULT_ZONES)).value;
  const origin = anyWh.pincode;
  const rows = new Map<string, PriceRow>();
  const pkg = (g: number) => [{ count: 1, lengthMm: 100, breadthMm: 100, heightMm: 100, actualWeightGrams: g }];
  for (const z of zones) {
    const dest = z.pin || origin;
    for (const g of SLABS_GRAMS) {
      const { offers } = await getQuotes({ mode: "B2C", originPincode: origin, destinationPincode: dest, paymentType: "prepaid", declaredValue: 100_000, direction: "forward", packages: pkg(g) }, orgId, { persist: false });
      for (const o of offers) {
        const k = `${o.carrierCode}|${o.serviceName}|${z.zone}`;
        const r = rows.get(k) ?? { carrierCode: o.carrierCode, carrierName: o.carrierName, serviceName: o.serviceName, mode: o.mode, zone: z.zone, cells: {}, codFee: null, eta: o.etaDays ?? null };
        r.cells[g] = o.total;
        rows.set(k, r);
      }
    }
    // COD fee per courier on this zone (₹1,000 COD, 500 g)
    const { offers: cod } = await getQuotes({ mode: "B2C", originPincode: origin, destinationPincode: dest, paymentType: "cod", codAmount: 100_000, declaredValue: 100_000, direction: "forward", packages: pkg(500) }, orgId, { persist: false });
    for (const o of cod) {
      const r = rows.get(`${o.carrierCode}|${o.serviceName}|${z.zone}`);
      if (r) r.codFee = o.lines.filter((l) => l.code === "cod_fee").reduce((t, l) => t + l.sellPreTax, 0) || null;
    }
  }
  const settings = await loadMarkupSettings();
  const m = nonKyc ?? resolveMarkup(settings, orgId);
  const ov = settings.overrides.filter((o) => o.orgId === orgId && !o.clearedAt).sort((a, b) => b.version - a.version)[0];
  const gst = await getSetting<number>("gst_bps", 1800);
  const list: PriceList = {
    generatedAt: new Date().toISOString(), origin, zones, rows: [...rows.values()].sort((a, b) => a.carrierName.localeCompare(b.carrierName) || a.zone.localeCompare(b.zone)),
    markupPct: m.bps / 100, personalized: m.source === "customer_override", nonKyc: !!nonKyc, effectiveFrom: ov ? ov.effectiveFrom.toISOString() : null, gstPct: gst.value / 100,
  };
  await saveOrgSetting(orgId, "price_list_cache", list);
  return list;
}
