import Link from "next/link";
import { and, desc, eq, inArray } from "drizzle-orm";
import { ApiKeys } from "@/components/portal/ApiKeys";
import { StoreConnections } from "@/components/portal/StoreConnections";
import { getDb, schema } from "@/server/db/client";
import { portalContext } from "@/server/portal/context";

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const sp = await searchParams;
  const tab = sp.tab === "api" || sp.tab === "webhooks" ? sp.tab : "stores";
  const ctx = await portalContext();
  const db = await getDb();
  const keys = tab === "api" ? await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.orgId, ctx.org.id)).orderBy(desc(schema.apiKeys.createdAt)) : [];
  return (
    <>
      <div className="page-h"><h1>Integrations</h1></div>
      <nav className="tabs" aria-label="Integrations">
        <Link href="/portal/integrations/" className={tab === "stores" ? "on" : ""}>Stores</Link>
        <Link href="/portal/integrations/?tab=api" className={tab === "api" ? "on" : ""}>API Credentials</Link>
        <Link href="/portal/integrations/?tab=webhooks" className={tab === "webhooks" ? "on" : ""}>Webhooks</Link>
      </nav>
      {tab === "stores" && await (async () => {
        const conns = await db.select().from(schema.storeConnections).where(eq(schema.storeConnections.orgId, ctx.org.id));
        const ids = conns.map((c) => c.id);
        const logs = ids.length ? await db.select().from(schema.storeImportLog).where(inArray(schema.storeImportLog.connectionId, ids)).orderBy(desc(schema.storeImportLog.createdAt)).limit(100) : [];
        const wh = await db.select().from(schema.warehouses).where(and(eq(schema.warehouses.orgId, ctx.org.id), eq(schema.warehouses.active, true)));
        return <StoreConnections
          conns={conns.map((c) => ({ id: c.id, platform: c.platform, storeUrl: c.storeUrl, status: c.status, hint: c.credentialsHint, warehouseId: c.warehouseId, autoSync: c.autoSync, pushTracking: c.pushTracking, lastSyncAt: c.lastSyncAt?.toISOString() ?? null, lastError: c.lastError, defaultPackage: c.defaultPackage as { lengthCm: number; breadthCm: number; heightCm: number; weightKg: number } }))}
          logs={logs.map((l) => ({ id: l.id, connectionId: l.connectionId, name: l.externalOrderName, outcome: l.outcome, message: l.message, orderId: l.orderId, at: l.createdAt.toISOString() }))}
          warehouses={wh.map((w) => ({ id: w.id, label: `${w.label} — ${w.city} ${w.pincode}` }))} />;
      })()}
      {tab === "api" && (
        <ApiKeys keys={keys.map((k) => ({ id: k.id, label: k.label, scopes: k.scopes as string[], createdAt: k.createdAt.toISOString(), lastUsedAt: k.lastUsedAt?.toISOString() ?? null, revokedAt: k.revokedAt?.toISOString() ?? null, expiresAt: k.expiresAt?.toISOString() ?? null }))} />
      )}
      {tab === "webhooks" && (
        <div className="card" style={{ padding: 16 }}>
          <p className="small">Webhook endpoint, event switches, test events and delivery history are managed under <Link className="link" href="/portal/notifications/?tab=webhook">Shipping Notifications → Webhook</Link>.</p>
          <p className="small muted">API reference: <Link className="link" href="/api/v1/openapi.json">OpenAPI spec</Link></p>
        </div>
      )}
    </>
  );
}
