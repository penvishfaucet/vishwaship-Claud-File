import Link from "next/link";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { ApiKeys } from "@/components/portal/ApiKeys";
import { getDb, schema } from "@/server/db/client";
import { requireFeature } from "@/server/features";
import { portalContext } from "@/server/portal/context";

const fmt = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

export default async function ApiIntegrationPage() {
  const ctx = await portalContext();
  await requireFeature(ctx.org.id, "api_integration");
  const db = await getDb();
  const keys = await db.select().from(schema.apiKeys).where(eq(schema.apiKeys.orgId, ctx.org.id)).orderBy(desc(schema.apiKeys.createdAt));
  const [ep] = await db.select().from(schema.webhookEndpoints).where(eq(schema.webhookEndpoints.orgId, ctx.org.id));
  const deliveries = ep ? await db.select().from(schema.webhookDeliveries).where(eq(schema.webhookDeliveries.endpointId, ep.id)).orderBy(desc(schema.webhookDeliveries.createdAt)).limit(20) : [];
  const apiLog = await db.select().from(schema.auditLog).where(and(eq(schema.auditLog.orgId, ctx.org.id), or(eq(schema.auditLog.actorKind, "api_key"), inArray(schema.auditLog.action, ["api_key.create", "api_key.revoke", "api_key.rotate", "webhook.endpoint_saved"])))).orderBy(desc(schema.auditLog.createdAt)).limit(20);
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return (
    <>
      <div className="page-h">
        <div><h1>API Integration</h1><p className="small muted" style={{ margin: "4px 0 0" }}>Create API keys for your own systems, receive shipment updates by webhook, and see recent API activity.</p></div>
        <div className="actions"><a className="btn btn-outline" href="/api/v1/openapi.json" target="_blank" rel="noreferrer">API documentation (OpenAPI)</a></div>
      </div>
      <section className="card mb16" style={{ padding: 16 }}>
        <h2 className="b" style={{ fontSize: 15, marginTop: 0 }}>Quick start</h2>
        <ol className="small" style={{ paddingLeft: 18, margin: 0 }}>
          <li>Create a key below and copy the secret — it is shown only once.</li>
          <li>Send it as <code>Authorization: Bearer &lt;key&gt;</code> to <code>{base}/api/v1/…</code> (quotes, orders, booking, tracking, labels, NDR).</li>
          <li>Use an <code>Idempotency-Key</code> header on POST requests so retries never create duplicates.</li>
          <li>Add a webhook URL to receive <code>shipment.status_changed</code> events, signed with HMAC-SHA256.</li>
        </ol>
      </section>
      <h2 className="b" style={{ fontSize: 15 }}>API keys</h2>
      <ApiKeys keys={keys.map((k) => ({ id: k.id, label: k.label, scopes: k.scopes as string[], createdAt: k.createdAt.toISOString(), lastUsedAt: k.lastUsedAt?.toISOString() ?? null, revokedAt: k.revokedAt?.toISOString() ?? null, expiresAt: k.expiresAt?.toISOString() ?? null }))} />
      <section className="card p0 mt16">
        <div className="row between card-h"><h2 className="b small" style={{ margin: 0 }}>Webhook</h2><Link className="btn btn-sm btn-outline" href="/portal/notifications/?tab=webhook">Configure webhook</Link></div>
        <div style={{ padding: "0 16px 12px" }} className="small">{ep ? <>Endpoint <span className="mono">{ep.url}</span> · <span className={`chip ${ep.active ? "c-active" : "c-draft"}`}>{ep.active ? "Active" : "Paused"}</span> · {(ep.events as string[]).length} event types</> : <span className="muted">No webhook configured.</span>}</div>
        {deliveries.length > 0 && <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Time</th><th>Event</th><th>Status</th><th>HTTP</th><th>Attempts</th></tr></thead>
          <tbody>{deliveries.map((d) => <tr key={d.id}><td className="small">{fmt(d.createdAt)}</td><td className="small mono">{d.eventType}</td><td><span className={`chip ${d.status === "delivered" ? "c-active" : d.status === "pending" ? "c-pending" : "c-failed"}`}>{d.status}</span></td><td className="small">{d.lastStatusCode ?? "—"}</td><td className="small">{d.attempts}</td></tr>)}</tbody></table></div>}
      </section>
      <section className="card p0 mt16">
        <h2 className="b small card-h" style={{ margin: 0 }}>Connection log</h2>
        {apiLog.length === 0 ? <p className="small muted" style={{ padding: 16 }}>No API activity yet.</p> : (
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Time</th><th>Activity</th><th>Reference</th></tr></thead>
            <tbody>{apiLog.map((l) => <tr key={l.id}><td className="small">{fmt(l.createdAt)}</td><td className="small">{l.action.replace(/[._]/g, " ")}{l.actorKind === "api_key" ? " (via API)" : ""}</td><td className="tiny mono">{l.targetId ?? "—"}</td></tr>)}</tbody></table></div>
        )}
      </section>
    </>
  );
}
