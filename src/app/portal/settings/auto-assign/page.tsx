import { and, asc, eq, isNotNull } from "drizzle-orm";
import { AssignRules } from "@/components/portal/AssignRules";
import { CARRIERS } from "@/lib/site";
import { courierAvailability } from "@/server/couriers";
import { getDb, schema } from "@/server/db/client";
import { requireFeature } from "@/server/features";
import { portalContext } from "@/server/portal/context";

export default async function AutoAssignPage() {
  const ctx = await portalContext();
  await requireFeature(ctx.org.id, "auto_assign");
  const db = await getDb();
  const rules = await db.select().from(schema.assignRules).where(eq(schema.assignRules.orgId, ctx.org.id)).orderBy(asc(schema.assignRules.priority));
  const wh = await db.select({ id: schema.warehouses.id, label: schema.warehouses.label }).from(schema.warehouses).where(and(eq(schema.warehouses.orgId, ctx.org.id), eq(schema.warehouses.active, true)));
  const admin = new Set((await courierAvailability()).disabled);
  const seen = await db.selectDistinct({ code: schema.quotes.carrierCode }).from(schema.quotes).where(isNotNull(schema.quotes.carrierCode));
  const couriers = [...new Set(seen.map((s) => s.code))].filter((c) => !admin.has(c)).map((code) => ({ code, name: CARRIERS.find((c) => c.code === code)?.name ?? code })).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      <div className="page-h"><div><h1>Auto-Assign Rule</h1><p className="small muted" style={{ margin: "4px 0 0" }}>Pick the courier automatically by shipment type, delivery PIN, warehouse, payment mode or weight. Rules are checked in priority order; if a rule’s couriers cannot serve the order, the next rule or your courier preference is used — the reason is always shown before booking.</p></div></div>
      <AssignRules rules={rules.map((r) => ({ id: r.id, name: r.name, priority: r.priority, active: r.active, conditions: { pinPrefixes: [], ...(r.conditions as object) }, couriers: r.couriers as string[] }))} couriers={couriers} warehouses={wh} />
    </>
  );
}
