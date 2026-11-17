import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { MODULES, NOTIFICATION_EVENTS, moduleLabel } from "@/lib/modules";
import { formatINR } from "@/lib/money";
import { FeatureButtons } from "@/components/admin/FeatureControls";
import { savePlan } from "@/server/admin/module-actions";
import { can } from "@/server/auth/rbac";
import { requireStaff } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";

export default async function PlansPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; edit?: string }> }) {
  const sp = await searchParams;
  const s = await requireStaff("customers.read");
  const write = can(s.role, "modules.manage");
  const db = await getDb();
  const plans = await db.select().from(schema.plans).orderBy(desc(schema.plans.active), schema.plans.pricePaise);
  const subs = await db.select({ planId: schema.orgSubscriptions.planId, n: sql<number>`count(*)::int` }).from(schema.orgSubscriptions).where(eq(schema.orgSubscriptions.status, "active")).groupBy(schema.orgSubscriptions.planId);
  const globals = await db.select().from(schema.featureOverrides).where(isNull(schema.featureOverrides.orgId));
  const custOverrides = await db.select({ module: schema.featureOverrides.module, n: sql<number>`count(*)::int` }).from(schema.featureOverrides).where(and(sql`${schema.featureOverrides.orgId} is not null`)).groupBy(schema.featureOverrides.module);
  const editing = plans.find((p) => p.id === sp.edit);
  const cur = editing ?? { id: "", name: "", description: "", pricePaise: 0, billingPeriodDays: 30, modules: [] as string[], events: [] as string[], active: true };
  return (
    <>
      <div className="page-h"><div><h1>Subscriptions &amp; Feature Access</h1><p className="small muted" style={{ margin: "4px 0 0" }}>Which modules each customer can use. Order of precedence: customer override → active plan → global setting → default. Enforced on the server for pages, APIs and downloads.</p></div></div>
      {sp.ok && <p className="note small mb12">{sp.ok}</p>}
      {sp.err && <p className="note small mb12 t-debit">{sp.err}</p>}

      <section className="card p0 mb16">
        <h2 className="b small card-h" style={{ margin: 0 }}>Global feature access</h2>
        <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Module</th><th>Default</th><th>Global setting</th><th>Customer overrides</th>{write && <th>Change</th>}</tr></thead>
          <tbody>{MODULES.map((m) => {
            const g = globals.find((x) => x.module === m.key);
            return (
              <tr key={m.key}>
                <td><b className="small">{m.label}</b>{m.needsPlan && <div className="tiny muted">Plan feature — needs a plan or customer override</div>}</td>
                <td className="small">{m.needsPlan ? "Off (plan only)" : m.default ? "On" : "Off"}</td>
                <td><span className={`chip ${g ? (g.enabled ? "c-active" : "c-failed") : "c-draft"}`}>{g ? (g.enabled ? "On for all" : "Off for all") : "Default"}</span></td>
                <td className="small">{custOverrides.find((c) => c.module === m.key)?.n ?? 0}</td>
                {write && <td>{m.needsPlan ? <span className="tiny muted">Use plans</span> : (
                  <FeatureButtons orgId={null} module={m.key} label={m.label} current={g ? (g.enabled ? "on" : "off") : "inherit"} />
                )}</td>}
              </tr>
            );
          })}</tbody></table></div>
      </section>

      <div className="split" style={{ gap: 16, alignItems: "start" }}>
        <section className="card p0">
          <h2 className="b small card-h" style={{ margin: 0 }}>Plans</h2>
          {plans.length === 0 ? <p className="small muted" style={{ padding: 16 }}>No plans yet. Create one to sell WhatsApp notifications or the branded tracking page.</p> : (
            <ul className="plain-list">{plans.map((p) => (
              <li key={p.id}>
                <div className="row between"><b>{p.name}</b><span className={`chip ${p.active ? "c-active" : "c-draft"}`}>{p.active ? "Active" : "Inactive"}</span></div>
                <div className="small muted">{formatINR(p.pricePaise)} / {p.billingPeriodDays} days · {subs.find((x) => x.planId === p.id)?.n ?? 0} customers</div>
                <div className="tiny">{(p.modules as string[]).map(moduleLabel).join(", ") || "No modules"}{(p.events as string[]).length ? ` · ${(p.events as string[]).map((e) => NOTIFICATION_EVENTS.find((x) => x.key === e)?.label ?? e).join(", ")}` : ""}</div>
                {write && <a className="small link-navy" href={`/admin/plans/?edit=${p.id}#plan-form`}>Edit</a>}
              </li>
            ))}</ul>
          )}
        </section>
        {write && (
          <section className="card" style={{ padding: 18 }} id="plan-form">
            <h2 className="b" style={{ fontSize: 15, marginTop: 0 }}>{editing ? `Edit “${editing.name}”` : "New plan"}</h2>
            <form action={savePlan} className="grid2" style={{ gap: 10 }}>
              <input type="hidden" name="id" value={cur.id} />
              <div className="field"><label htmlFor="pn">Name</label><input id="pn" name="name" className="input" defaultValue={cur.name} required maxLength={60} /></div>
              <div className="field"><label htmlFor="pp">Price (₹, excl. GST)</label><input id="pp" name="price" type="number" min={0} step="0.01" className="input" defaultValue={cur.pricePaise / 100} /></div>
              <div className="field"><label htmlFor="pd">Billing period (days)</label><input id="pd" name="period" type="number" min={1} className="input" defaultValue={cur.billingPeriodDays} /></div>
              <label className="check small" style={{ alignSelf: "end" }}><input type="checkbox" name="active" defaultChecked={cur.active} /> Active (can be assigned)</label>
              <div className="field" style={{ gridColumn: "1 / -1" }}><label htmlFor="pdesc">Description (shown to customers)</label><input id="pdesc" name="description" className="input" defaultValue={cur.description ?? ""} maxLength={300} /></div>
              <fieldset style={{ gridColumn: "1 / -1", border: 0, padding: 0 }}><legend className="small b">Modules</legend>
                {MODULES.map((m) => <label key={m.key} className="check small" style={{ display: "block" }}><input type="checkbox" name="modules" value={m.key} defaultChecked={(cur.modules as string[]).includes(m.key)} /> {m.label}</label>)}
              </fieldset>
              <fieldset style={{ gridColumn: "1 / -1", border: 0, padding: 0 }}><legend className="small b">Notification events</legend>
                {NOTIFICATION_EVENTS.map((e) => <label key={e.key} className="check small" style={{ display: "block" }}><input type="checkbox" name="events" value={e.key} defaultChecked={(cur.events as string[]).includes(e.key)} /> {e.label}</label>)}
                <p className="tiny muted">Events also need the WhatsApp notifications module in the same plan.</p>
              </fieldset>
              <button className="btn btn-orange">{editing ? "Save plan" : "Create plan"}</button>
            </form>
          </section>
        )}
      </div>
    </>
  );
}
