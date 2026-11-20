import { notFound } from "next/navigation";
import { and, desc, eq, like } from "drizzle-orm";
import { THEMES, readSettings, readTheme } from "@/lib/store-themes";
import { applyCustomDesign, setDomainSsl, setStoreSuspended } from "@/server/admin/store-actions";
import { can } from "@/server/auth/rbac";
import { requireStaff } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";

const when = (d: Date | null) => (d ? d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

export default async function AdminStoreDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string }> }) {
  const staff = await requireStaff("customers.read");
  const { id } = await params;
  const sp = await searchParams;
  const db = await getDb();
  const [row] = await db.select({ s: schema.stores, org: schema.orgs.businessName }).from(schema.stores).innerJoin(schema.orgs, eq(schema.orgs.id, schema.stores.orgId)).where(eq(schema.stores.id, id));
  if (!row) notFound();
  const s = row.s;
  const [doms, versions, log, prods] = await Promise.all([
    db.select().from(schema.storeDomains).where(eq(schema.storeDomains.storeId, s.id)),
    db.select().from(schema.storeThemeVersions).where(eq(schema.storeThemeVersions.storeId, s.id)).orderBy(desc(schema.storeThemeVersions.version)).limit(10),
    db.select().from(schema.auditLog).where(and(eq(schema.auditLog.orgId, s.orgId), like(schema.auditLog.action, "store.%"))).orderBy(desc(schema.auditLog.createdAt)).limit(40),
    db.select({ id: schema.storeProducts.id, status: schema.storeProducts.status }).from(schema.storeProducts).where(eq(schema.storeProducts.storeId, s.id)),
  ]);
  const manage = can(staff.role, "modules.manage");
  const sslWrite = can(staff.role, "integrations.write");
  const settings = readSettings(s.settings);
  const draft = readTheme(s.draftTheme, s.themeKey);
  return (
    <>
      <div className="page-h">
        <div><p className="small muted" style={{ margin: 0 }}><a href="/admin/online-stores/">Online Stores</a></p><h1>{s.name}</h1>
          <p className="small muted" style={{ margin: "4px 0 0" }}>{row.org} · <span className="mono">/s/{s.slug}</span> · <span className={`chip ${s.status === "live" ? "c-active" : s.status === "suspended" ? "c-failed" : "c-draft"}`}>{s.status}</span></p></div>
        <div className="row" style={{ gap: 6 }}>{s.status === "live" && <a className="btn btn-outline" href={`/s/${s.slug}/`} target="_blank" rel="noreferrer">Open store</a>}</div>
      </div>
      {sp.ok && <p className="note small mb12">{sp.ok}</p>}
      {sp.err && <p className="err-box small mb12" role="alert">{sp.err}</p>}
      <div className="grid2" style={{ alignItems: "start" }}>
        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ fontSize: 14, marginBottom: 8 }}>Overview</h3>
          <dl className="kv-list">
            <dt>Onboarding</dt><dd>{(s.stepsDone as number[]).join(", ") || "—"} done · at step {s.onboardingStep}</dd>
            <dt>Products</dt><dd>{prods.filter((p) => p.status === "active").length} active / {prods.length} total</dd>
            <dt>Theme</dt><dd>{s.themeKey}{s.customDesign ? " (custom design, locked)" : ""}</dd>
            <dt>COD</dt><dd>{settings.checkout.codEnabled ? "On" : "Off"}</dd>
            <dt>Created</dt><dd>{when(s.createdAt)}</dd>
            <dt>Published</dt><dd>{when(s.publishedAt)}</dd>
            {s.suspendedReason && <><dt>Pause reason</dt><dd className="red">{s.suspendedReason}</dd></>}
          </dl>
          {manage && (
            <form action={setStoreSuspended} style={{ marginTop: 14, display: "grid", gap: 8 }}>
              <input type="hidden" name="storeId" value={s.id} />
              {s.status === "suspended" ? (
                <><input type="hidden" name="suspend" value="0" /><button className="btn btn-outline">Release store</button></>
              ) : (
                <><input type="hidden" name="suspend" value="1" />
                  <div className="field"><label htmlFor="reason">Pause reason (shown to the merchant)</label><input id="reason" name="reason" className="input" maxLength={300} required /></div>
                  <button className="btn btn-outline">Pause store</button></>
              )}
            </form>
          )}
        </div>
        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ fontSize: 14, marginBottom: 8 }}>Domains</h3>
          {doms.length === 0 ? <p className="small muted">No custom domains.</p> : (
            <table className="tbl"><thead><tr><th>Domain</th><th>DNS</th><th>SSL</th></tr></thead><tbody>{doms.map((d) => (
              <tr key={d.id}>
                <td className="small mono">{d.hostname}{d.isPrimary && <span className="tiny muted"> · primary</span>}</td>
                <td className="small">{d.status}<div className="tiny muted">{d.lastCheckMessage ?? ""}</div></td>
                <td>{sslWrite ? (
                  <form action={setDomainSsl} className="row" style={{ gap: 4 }}><input type="hidden" name="domainId" value={d.id} />
                    <select name="ssl" defaultValue={d.sslStatus} className="input select" style={{ height: 30, fontSize: 12 }} aria-label={`SSL for ${d.hostname}`}>{["pending_setup", "pending", "active", "failed"].map((x) => <option key={x}>{x}</option>)}</select>
                    <button className="btn btn-sm btn-outline">Save</button></form>
                ) : <span className="small">{d.sslStatus}</span>}</td>
              </tr>
            ))}</tbody></table>
          )}
          <p className="tiny muted" style={{ marginTop: 8 }}>Set SSL to active only after the edge proxy has issued the certificate for that hostname.</p>
        </div>
      </div>
      {manage && (
        <form action={applyCustomDesign} className="card" style={{ padding: 16, marginTop: 16 }}>
          <h3 style={{ fontSize: 14, marginBottom: 4 }}>Apply custom design</h3>
          <p className="small muted" style={{ marginTop: 0 }}>Edit the theme JSON (colours, fonts, sections). This changes only this store&apos;s draft. Lock stops the merchant from switching themes.</p>
          <input type="hidden" name="storeId" value={s.id} />
          <div className="field"><label htmlFor="tk">Base theme</label><select id="tk" name="themeKey" className="input select" defaultValue={s.themeKey}>{THEMES.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}</select></div>
          <div className="field" style={{ marginTop: 8 }}><label htmlFor="cfg">Design JSON</label><textarea id="cfg" name="config" className="input mono" rows={14} defaultValue={JSON.stringify(draft, null, 2)} style={{ fontSize: 11.5 }} /></div>
          <div className="row wrap" style={{ gap: 16, marginTop: 8 }}>
            <label className="row" style={{ gap: 6 }}><input type="checkbox" name="lock" value="1" defaultChecked={s.customDesign} /> Lock theme for merchant</label>
            <label className="row" style={{ gap: 6 }}><input type="checkbox" name="publish" value="1" disabled={s.status !== "live"} /> Publish now (store is {s.status})</label>
          </div>
          <button className="btn btn-orange" style={{ marginTop: 10 }}>Apply design</button>
        </form>
      )}
      <div className="grid2" style={{ alignItems: "start", marginTop: 16 }}>
        <div className="card p0"><div className="card-h"><b>Published versions</b></div>
          {versions.length === 0 ? <p className="small muted" style={{ padding: 16 }}>Never published.</p> : <table className="tbl"><tbody>{versions.map((v) => <tr key={v.id}><td className="small">v{v.version}</td><td className="small">{v.themeKey}</td><td className="small">{v.note ?? ""}</td><td className="small">{when(v.createdAt)}</td></tr>)}</tbody></table>}
        </div>
        <div className="card p0"><div className="card-h"><b>Store activity (audit log)</b></div>
          {log.length === 0 ? <p className="small muted" style={{ padding: 16 }}>No activity yet.</p> : <table className="tbl"><tbody>{log.map((l) => <tr key={l.id}><td className="small mono">{l.action}</td><td className="small">{l.actorKind}</td><td className="small">{when(l.createdAt)}</td></tr>)}</tbody></table>}
        </div>
      </div>
    </>
  );
}
