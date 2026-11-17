import { desc, eq } from "drizzle-orm";
import { ApiKeys } from "@/components/portal/ApiKeys";
import { requireStaff } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";

/** Settings → API Credentials (owner only). Keys created here authenticate against /api/v1. */
export default async function AdminApiCredentials() {
  await requireStaff("api_keys.manage");
  const db = await getDb();
  const orgs = await db.select({ id: schema.orgs.id, name: schema.orgs.businessName }).from(schema.orgs).orderBy(schema.orgs.businessName);
  const keys = await db.select({ k: schema.apiKeys, orgName: schema.orgs.businessName }).from(schema.apiKeys)
    .leftJoin(schema.orgs, eq(schema.orgs.id, schema.apiKeys.orgId)).orderBy(desc(schema.apiKeys.createdAt));
  return (
    <>
      <div className="page-h"><div><h1>API Credentials</h1><p className="small muted" style={{ margin: "4px 0 0" }}>Vishwaship’s own API (<span className="mono">/api/v1</span>). Carrier / payment keys are managed under Integrations instead.</p></div></div>
      <ApiKeys
        endpoint="/api/admin/api-keys"
        orgs={orgs}
        keys={keys.map(({ k, orgName }) => ({ id: k.id, label: k.label, scopes: k.scopes as string[], createdAt: k.createdAt.toISOString(), lastUsedAt: k.lastUsedAt?.toISOString() ?? null, revokedAt: k.revokedAt?.toISOString() ?? null, expiresAt: k.expiresAt?.toISOString() ?? null, orgName: orgName ?? "—" }))}
      />
      <p className="tiny muted mt12">API reference: <a className="link" href="/api/v1/openapi.json">/api/v1/openapi.json</a>. Every create, rotate and revoke is recorded in the Audit Log.</p>
    </>
  );
}
