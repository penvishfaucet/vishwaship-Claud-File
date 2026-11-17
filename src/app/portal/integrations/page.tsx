import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { ApiKeys } from "@/components/portal/ApiKeys";
import { getDb, schema } from "@/server/db/client";
import { portalContext } from "@/server/portal/context";

const STORES = [
  { key: "shopify", name: "Shopify", desc: "Import paid/COD orders via Shopify Admin API (OAuth, read_orders + write_fulfillments)." },
  { key: "woocommerce", name: "WooCommerce", desc: "Connect with WooCommerce REST API keys (read/write) over HTTPS." },
  { key: "custom", name: "Custom website / API", desc: "Push orders to Vishwaship with your API key and receive status webhooks." },
];

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
      {tab === "stores" && (
        <div className="grid3" style={{ gap: 12 }}>
          {STORES.map((s) => (
            <article key={s.key} className="card" style={{ padding: 16 }}>
              <div className="row between"><b>{s.name}</b><span className="chip c-draft">Not connected</span></div>
              <p className="small muted">{s.desc}</p>
              {s.key === "custom"
                ? <Link className="btn btn-sm btn-orange" href="/portal/integrations/?tab=api">Manage</Link>
                : <button className="btn btn-sm btn-outline" disabled title="Store connector available after Shopify/WooCommerce app credentials are configured by Vishwaship admin">Connect (coming soon)</button>}
            </article>
          ))}
        </div>
      )}
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
