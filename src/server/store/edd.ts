import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { orgSetting } from "@/server/couriers";
import { ORG_SETTING_SCHEMAS } from "@/lib/org-settings";
import { getQuotes } from "@/server/quotes/service";
import { readSettings } from "@/lib/store-themes";

/**
 * "Delivery by …" for a buyer pincode, from the store's pickup warehouse: dispatch day (processing days from the
 * merchant's delivery-date settings, cutoff hour, Sundays skipped) + the fastest serviceable courier's transit days.
 * The courier name is never shown to buyers.
 */
export type StoreEdd = { serviceable: false } | { serviceable: true; date: string; days: number; cod: boolean };
const cache = new Map<string, { at: number; v: StoreEdd }>();

export async function storeEdd(store: { id: string; orgId: string; settings: unknown }, pin: string, now = new Date()): Promise<StoreEdd> {
  const st = readSettings(store.settings).checkout;
  if (!st.warehouseId || !/^[1-9]\d{5}$/.test(pin)) return { serviceable: false };
  const key = `${store.id}:${pin}:${now.toISOString().slice(0, 13)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.v;
  const db = await getDb();
  const [wh] = await db.select().from(schema.warehouses).where(and(eq(schema.warehouses.id, st.warehouseId), eq(schema.warehouses.orgId, store.orgId)));
  if (!wh) return { serviceable: false };
  const cfg = ORG_SETTING_SCHEMAS.edd_widget.parse((await orgSetting(store.orgId, "edd_widget")) ?? {});
  const run = async (paymentType: "prepaid" | "cod") => (await getQuotes({
    mode: "B2C", originPincode: wh.pincode, destinationPincode: pin, paymentType, declaredValue: 100_000, direction: "forward",
    packages: [{ count: 1, lengthMm: 200, breadthMm: 150, heightMm: 100, actualWeightGrams: 500 }],
  }, store.orgId, { persist: false })).offers;
  const offers = await run("prepaid");
  const best = offers.filter((o) => o.etaDays != null).sort((a, b) => a.etaDays! - b.etaDays!)[0];
  let v: StoreEdd;
  if (!best) v = { serviceable: false };
  else {
    const ist = new Date(now.getTime() + 5.5 * 3600_000);
    const today = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate());
    const d = new Date(today);
    let dispatch = cfg.processingDays + (ist.getUTCHours() >= cfg.cutoffHour ? 1 : 0);
    while (dispatch > 0 || d.getUTCDay() === 0) { d.setUTCDate(d.getUTCDate() + 1); if (d.getUTCDay() !== 0) dispatch--; }
    d.setUTCDate(d.getUTCDate() + best.etaDays!);
    const cod = st.codEnabled ? (await run("cod").catch(() => [])).length > 0 : false;
    v = { serviceable: true, date: d.toISOString().slice(0, 10), days: Math.round((d.getTime() - today) / 86400_000), cod };
  }
  cache.set(key, { at: Date.now(), v });
  if (cache.size > 5000) cache.clear();
  return v;
}
