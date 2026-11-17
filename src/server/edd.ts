import "server-only";
import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { hasFeature } from "@/server/features";
import { ORG_SETTING_SCHEMAS, type OrgSettingValue } from "@/lib/org-settings";
import { getQuotes } from "@/server/quotes/service";
import { orgSetting, saveOrgSetting } from "@/server/couriers";

/** Public, unguessable widget key per account (never the org id). */
export async function eddWidgetKey(orgId: string) {
  const k = await orgSetting<{ key: string }>(orgId, "edd_widget_key");
  if (k?.key) return k.key;
  const key = `edd_${randomBytes(12).toString("base64url")}`;
  await saveOrgSetting(orgId, "edd_widget_key", { key });
  return key;
}

export async function eddConfigByKey(key: string) {
  if (!/^edd_[A-Za-z0-9_-]{16}$/.test(key)) return null;
  const db = await getDb();
  const [r] = await db.select().from(schema.orgSettings).where(and(eq(schema.orgSettings.key, "edd_widget_key"), sql`${schema.orgSettings.value}->>'key' = ${key}`));
  if (!r) return null;
  const cfg = ORG_SETTING_SCHEMAS.edd_widget.parse((await orgSetting(r.orgId, "edd_widget")) ?? {});
  return { orgId: r.orgId, cfg };
}

const cache = new Map<string, { at: number; v: EddResult }>();
export type EddResult = { serviceable: false } | { serviceable: true; date: string; days: number; courier?: string };

/** Estimate = dispatch day (processing days, after cutoff → next day) + fastest serviceable transit time. Sundays skipped for dispatch. */
export async function estimate(orgId: string, cfg: OrgSettingValue<"edd_widget">, pin: string, now = new Date()): Promise<EddResult> {
  const ck = `${orgId}:${pin}:${now.toISOString().slice(0, 13)}`;
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < 6 * 3600_000) return hit.v;
  const db = await getDb();
  const [wh] = await db.select().from(schema.warehouses).where(and(eq(schema.warehouses.orgId, orgId), eq(schema.warehouses.active, true), eq(schema.warehouses.isDefault, true)));
  if (!wh || !(await hasFeature(orgId, "edd_widget"))) return { serviceable: false };
  const { offers } = await getQuotes({ mode: "B2C", originPincode: wh.pincode, destinationPincode: pin, paymentType: "prepaid", declaredValue: 100_000, direction: "forward", packages: [{ count: 1, lengthMm: 200, breadthMm: 150, heightMm: 100, actualWeightGrams: 500 }] }, orgId, { persist: false });
  const best = offers.filter((o) => o.etaDays != null).sort((a, b) => a.etaDays! - b.etaDays!)[0];
  let v: EddResult;
  if (!best) v = { serviceable: false };
  else {
    const ist = new Date(now.getTime() + 5.5 * 3600_000);
    const d = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
    let dispatch = cfg.processingDays + (ist.getUTCHours() >= cfg.cutoffHour ? 1 : 0);
    while (dispatch > 0 || d.getUTCDay() === 0) { d.setUTCDate(d.getUTCDate() + 1); if (d.getUTCDay() !== 0) dispatch--; }
    d.setUTCDate(d.getUTCDate() + best.etaDays!);
    const days = Math.round((d.getTime() - Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate())) / 86400_000);
    v = { serviceable: true, date: d.toISOString().slice(0, 10), days, ...(cfg.showCourier ? { courier: best.carrierName } : {}) };
  }
  cache.set(ck, { at: Date.now(), v });
  if (cache.size > 5000) cache.clear();
  return v;
}
