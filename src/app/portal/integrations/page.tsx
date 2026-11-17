import { redirect } from "next/navigation";
import { and, desc, eq, inArray } from "drizzle-orm";
import { StoreConnections } from "@/components/portal/StoreConnections";
import { getDb, schema } from "@/server/db/client";
import { portalContext } from "@/server/portal/context";
import { requireFeature } from "@/server/features";

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const sp = await searchParams;
  if (sp.tab === "api" || sp.tab === "webhooks") redirect("/portal/integrations/api/");
  const ctx = await portalContext();
  await requireFeature(ctx.org.id, "store_channels");
  const db = await getDb();
  return (
    <>
      <div className="page-h"><div><h1>Order Channels</h1><p className="small muted" style={{ margin: "4px 0 0" }}>Connect Shopify or WooCommerce to import orders automatically. Sync status, last sync time and import errors are shown per store; failed orders can be retried with Sync now.</p></div></div>
      {await (async () => {
        const conns = await db.select().from(schema.storeConnections).where(eq(schema.storeConnections.orgId, ctx.org.id));
        const ids = conns.map((c) => c.id);
        const logs = ids.length ? await db.select().from(schema.storeImportLog).where(inArray(schema.storeImportLog.connectionId, ids)).orderBy(desc(schema.storeImportLog.createdAt)).limit(100) : [];
        const wh = await db.select().from(schema.warehouses).where(and(eq(schema.warehouses.orgId, ctx.org.id), eq(schema.warehouses.active, true)));
        return <StoreConnections
          conns={conns.map((c) => ({ id: c.id, platform: c.platform, storeUrl: c.storeUrl, status: c.status, hint: c.credentialsHint, warehouseId: c.warehouseId, autoSync: c.autoSync, pushTracking: c.pushTracking, lastSyncAt: c.lastSyncAt?.toISOString() ?? null, lastError: c.lastError, defaultPackage: c.defaultPackage as { lengthCm: number; breadthCm: number; heightCm: number; weightKg: number } }))}
          logs={logs.map((l) => ({ id: l.id, connectionId: l.connectionId, name: l.externalOrderName, outcome: l.outcome, message: l.message, orderId: l.orderId, at: l.createdAt.toISOString() }))}
          warehouses={wh.map((w) => ({ id: w.id, label: `${w.label} — ${w.city} ${w.pincode}` }))} />;
      })()}
    </>
  );
}
