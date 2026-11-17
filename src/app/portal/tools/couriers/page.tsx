import { desc, isNotNull, sql } from "drizzle-orm";
import { CourierManager } from "@/components/portal/CourierManager";
import { CARRIERS, carrierLogo } from "@/lib/site";
import { courierAvailability, courierPrefs } from "@/server/couriers";
import { getDb, schema } from "@/server/db/client";
import { portalContext } from "@/server/portal/context";

export default async function ManageCourierPage() {
  const ctx = await portalContext();
  const db = await getDb();
  const admin = new Set((await courierAvailability()).disabled);
  const prefs = await courierPrefs(ctx.org.id);
  // services actually offered recently (from priced quotes), so the list reflects live accounts
  const seen = await db.select({ code: schema.quotes.carrierCode, service: schema.quotes.serviceName, n: sql<number>`count(*)::int` }).from(schema.quotes)
    .where(isNotNull(schema.quotes.carrierCode)).groupBy(schema.quotes.carrierCode, schema.quotes.serviceName).orderBy(desc(sql`count(*)`)).limit(200);
  const codes = new Set([...CARRIERS.map((c) => c.code), ...seen.map((s) => s.code)]);
  const name = (c: string) => CARRIERS.find((x) => x.code === c)?.name ?? c.replace(/-/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
  const couriers = [...codes].map((code) => ({ code, name: name(code), logo: carrierLogo(code), available: !admin.has(code) && seen.some((s) => s.code === code), services: [...new Set(seen.filter((s) => s.code === code).map((s) => s.service))] }));
  return (
    <>
      <div className="page-h"><div><h1>Manage Courier</h1><p className="small muted" style={{ margin: "4px 0 0" }}>Choose which couriers appear in your rates and set your preference order. Auto-Assign uses this order when a rule does not name a courier.</p></div></div>
      <CourierManager couriers={couriers.sort((a, b) => Number(b.available) - Number(a.available))} initial={prefs} />
      <p className="tiny muted mt8">“Not offered by Vishwaship” means the courier is not connected or has been paused by Vishwaship for all accounts.</p>
    </>
  );
}
