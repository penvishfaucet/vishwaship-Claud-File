import Link from "next/link";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { audit } from "@/server/audit";
import { can } from "@/server/auth/rbac";
import { requireStaff } from "@/server/auth/session";
import { StorageTest } from "@/components/admin/StorageTest";
import { storageDriver } from "@/server/storage";
import { getDb, schema } from "@/server/db/client";
import { PROVIDER_CATALOG, getAdapter, providerContext } from "@/server/providers/registry";
import { encryptJson, maskSecret } from "@/server/security/crypto";

const CATS = [["shipping", "Shipping"], ["payments", "Payments"], ["messaging", "WhatsApp/SMS"], ["email", "Email"]] as const;
const SECRET_FIELDS: Record<string, string[]> = {
  shipmozo: ["publicKey", "privateKey"], delhivery_b2b: ["username", "password"], delhivery_b2c: ["apiToken"], razorpay: ["keyId", "keySecret", "webhookSecret"], cashfree: ["clientId", "clientSecret"], wati: ["apiEndpoint", "accessToken", "webhookToken"],
  resend: ["apiKey"], smtp: ["host", "port", "username", "password"], sms: ["apiKey", "senderId"], demo: [],
};

async function saveCreds(fd: FormData) {
  "use server";
  const s = await requireStaff("integrations.write");
  const id = String(fd.get("id"));
  const db = await getDb();
  const [a] = await db.select().from(schema.providerAccounts).where(eq(schema.providerAccounts.id, id));
  if (!a) return;
  const fields = SECRET_FIELDS[a.adapter] ?? [];
  const secrets: Record<string, string> = {};
  for (const f of fields) { const v = String(fd.get(f) ?? "").trim(); if (v) secrets[f] = v; }
  if (Object.keys(secrets).length !== fields.length) redirect(`/admin/integrations/?id=${id}&err=fields`);
  await db.update(schema.providerAccounts).set({ secretsEnc: encryptJson(secrets), secretsHint: Object.fromEntries(Object.entries(secrets).map(([k, v]) => [k, maskSecret(v)])), mode: String(fd.get("mode")) === "live" ? "live" : "test" }).where(eq(schema.providerAccounts.id, id));
  await audit({ actorUserId: s.userId, actorKind: "staff", action: "integration.credentials_rotated", targetType: "provider_account", targetId: id, details: { adapter: a.adapter, fields } });
  redirect(`/admin/integrations/?id=${id}&ok=saved`);
}

async function testConn(fd: FormData) {
  "use server";
  const s = await requireStaff("integrations.write");
  const id = String(fd.get("id"));
  const db = await getDb();
  const [a] = await db.select().from(schema.providerAccounts).where(eq(schema.providerAccounts.id, id));
  if (!a) return;
  const ad = getAdapter(a.adapter);
  let ok = false, msg = "Adapter required for this provider";
  if (ad) { const r = await ad.health(await providerContext(a)); ok = r.ok; msg = r.ok ? r.value.message : r.error.message; }
  await db.update(schema.providerAccounts).set({ lastTestAt: new Date(), lastTestOk: ok, lastTestMessage: msg.slice(0, 200) }).where(eq(schema.providerAccounts.id, id));
  await audit({ actorUserId: s.userId, actorKind: "staff", action: "integration.test", targetType: "provider_account", targetId: id, details: { ok } });
  redirect(`/admin/integrations/?id=${id}`);
}

async function setStatus(fd: FormData) {
  "use server";
  const s = await requireStaff("integrations.write");
  const id = String(fd.get("id")), status = String(fd.get("status"));
  if (!["enabled", "disabled", "archived"].includes(status)) return;
  const db = await getDb();
  const [a] = await db.select().from(schema.providerAccounts).where(eq(schema.providerAccounts.id, id));
  if (status === "enabled" && a && a.category === "shipping" && !getAdapter(a.adapter)) redirect(`/admin/integrations/?id=${id}&err=adapter`);
  await db.update(schema.providerAccounts).set({ status }).where(eq(schema.providerAccounts.id, id));
  await audit({ actorUserId: s.userId, actorKind: "staff", action: `integration.${status}`, targetType: "provider_account", targetId: id });
  redirect(`/admin/integrations/?id=${id}`);
}

export default async function Integrations({ searchParams }: { searchParams: Promise<{ cat?: string; id?: string; ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const s = await requireStaff("integrations.read");
  const write = can(s.role, "integrations.write");
  const cat = CATS.find(([k]) => k === sp.cat)?.[0] ?? "shipping";
  const db = await getDb();
  const accounts = await db.select().from(schema.providerAccounts);
  const sel = sp.id ? accounts.find((a) => a.id === sp.id) : undefined;
  const openShipments = sel ? (await db.select({ id: schema.shipments.id }).from(schema.shipments).where(eq(schema.shipments.providerAccountId, sel.id))).length : 0;
  return (
    <>
      <div className="page-h"><h1>Integrations</h1></div>
      <StorageTest driver={storageDriver()} bucket={process.env.S3_BUCKET ?? null} canTest={write} />
      {cat === "shipping" && <p className="note small">Courier accounts (Shipmozo, Delhivery Direct, Shipora X, Ekart, TCI, Blue Dart) are set up, verified and activated in <Link className="link-navy" href="/admin/carriers/">Settings → Courier Integrations</Link>.</p>}
      <nav className="tabs">{CATS.map(([k, l]) => <Link key={k} href={`/admin/integrations/?cat=${k}`} className={cat === k ? "on" : ""}>{l}</Link>)}</nav>
      <div className="card p0 tbl-wrap mb16"><table className="tbl"><thead><tr><th>Account</th><th>Adapter</th><th>Mode</th><th>Status</th><th>Last test</th><th /></tr></thead>
        <tbody>{accounts.filter((a) => a.category === cat).map((a) => <tr key={a.id}><td className="b">{a.label}</td><td className="small">{a.adapter}{!getAdapter(a.adapter) && ["shipping"].includes(a.category) ? <span className="chip c-pending" style={{ marginLeft: 6 }}>Adapter required</span> : null}</td><td>{a.mode}</td><td><span className={`chip ${a.status === "enabled" ? "c-active" : "c-draft"}`}>{a.status}</span></td><td className="small">{a.lastTestAt ? `${a.lastTestOk ? "✓" : "✗"} ${a.lastTestAt.toLocaleString("en-IN")}` : "Never"}</td><td><Link className="btn btn-sm btn-outline" href={`/admin/integrations/?cat=${cat}&id=${a.id}`}>Manage</Link></td></tr>)}</tbody></table></div>
      <p className="tiny muted mb16">Catalog: {PROVIDER_CATALOG.filter((p) => p.category === cat).map((p) => `${p.name} (${p.status.replace("_", " ")})`).join(" · ")}</p>
      {sel && (
        <section className="card" style={{ padding: 18 }}>
          <div className="row between"><h2 style={{ fontSize: 17, margin: 0 }}>{sel.label}</h2><span className="tiny muted mono">{sel.id}</span></div>
          {sp.ok && <p className="small t-credit">Credentials saved (encrypted, write-only).</p>}
          {sp.err && <p className="small err">{sp.err === "adapter" ? "This provider needs an adapter before it can be enabled." : "All credential fields are required."}</p>}
          <div className="split mt12" style={{ gap: 16, alignItems: "start" }}>
            <div>
              <h3 className="small b">Configuration</h3>
              {write ? (
                <form action={saveCreds} className="col" style={{ gap: 8 }}>
                  <input type="hidden" name="id" value={sel.id} />
                  <div className="field"><label htmlFor="mode">Mode</label><select id="mode" name="mode" className="select" defaultValue={sel.mode}><option value="test">Test / sandbox</option><option value="live">Live</option></select></div>
                  {(SECRET_FIELDS[sel.adapter] ?? []).map((f) => <div key={f} className="field"><label htmlFor={f}>{f}</label><input id={f} name={f} className="input" type="password" autoComplete="off" placeholder={(sel.secretsHint as Record<string, string> | null)?.[f] ?? "Not set"} /></div>)}
                  <div className="row" style={{ gap: 8 }}><button className="btn btn-orange btn-sm">Save</button><button formAction={testConn} className="btn btn-outline btn-sm">Test Connection</button></div>
                  <p className="tiny muted">Secrets are encrypted with the server key and can never be viewed again — only replaced.</p>
                </form>
              ) : <p className="small muted">Read-only.</p>}
              {sel.lastTestMessage && <p className="small mt8">Last test: {sel.lastTestOk ? "✓" : "✗"} {sel.lastTestMessage}</p>}
            </div>
            <div>
              <h3 className="small b">Capabilities</h3>
              <ul className="plain-list">{Object.entries((sel.capabilities as Record<string, string>) ?? {}).map(([k, v]) => <li key={k} className="row between"><span className="small">{k}</span><span className="chip c-pending">{v.replace(/_/g, " ")}</span></li>)}{Object.keys(sel.capabilities as object).length === 0 && <li className="small muted">Not certified yet — every capability is “implemented / awaiting credentials” or “unsupported”.</li>}</ul>
              {write && (
                <div className="mt12 col" style={{ gap: 6 }}>
                  <p className="tiny muted">Disabling stops new bookings/sends via this account. {openShipments} existing shipment(s) stay linked and keep tracking/reconciliation.</p>
                  <div className="row" style={{ gap: 6 }}>
                    {([["enabled", "Enable", "btn-green", sel.status !== "enabled"], ["disabled", "Disable", "btn-outline", sel.status === "enabled"], ["archived", "Archive", "btn-red", sel.status === "disabled"]] as const).filter(([, , , show]) => show).map(([v, l, c]) => (
                      <form key={v} action={setStatus}><input type="hidden" name="id" value={sel.id} /><input type="hidden" name="status" value={v} /><button className={`btn btn-sm ${c}`}>{l}</button></form>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>
      )}
    </>
  );
}
