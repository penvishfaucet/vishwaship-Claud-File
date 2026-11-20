import { and, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { setHelpRequestStatus } from "@/server/admin/store-actions";
import { can } from "@/server/auth/rbac";
import { requireStaff } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";

type SP = Promise<{ tab?: string; status?: string; q?: string; step?: string; ok?: string; err?: string }>;
const STATUS_CHIP: Record<string, string> = { live: "c-active", draft: "c-draft", paused: "c-draft", suspended: "c-failed" };
const when = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export default async function AdminOnlineStores({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const staff = await requireStaff("customers.read");
  const db = await getDb();
  const tab = sp.tab === "help" ? "help" : "stores";
  const [{ newHelp }] = await db.select({ newHelp: sql<number>`count(*)::int` }).from(schema.storeHelpRequests).where(eq(schema.storeHelpRequests.status, "new"));

  const tabs = (
    <nav className="tabs mb12" aria-label="Online stores">
      <a className={tab === "stores" ? "on" : ""} href="/admin/online-stores/">Stores</a>
      <a className={tab === "help" ? "on" : ""} href="/admin/online-stores/?tab=help">Help requests{newHelp > 0 && <span className="n">{newHelp}</span>}</a>
    </nav>
  );
  const notes = <>{sp.ok && <p className="note small mb12">{sp.ok}</p>}{sp.err && <p className="err-box small mb12" role="alert">{sp.err}</p>}</>;

  if (tab === "help") {
    const rows = await db.select().from(schema.storeHelpRequests).orderBy(desc(schema.storeHelpRequests.createdAt)).limit(200);
    const write = can(staff.role, "tickets.write");
    return (
      <>
        <div className="page-h"><div><h1>Online Stores</h1><p className="small muted" style={{ margin: "4px 0 0" }}>Call-back requests from the Create Your Online Store page.</p></div></div>
        {tabs}{notes}
        {rows.length === 0 ? <div className="card empty"><p className="muted">No help requests yet.</p></div> : (
          <div className="card p0 tbl-wrap"><table className="tbl"><thead><tr><th>Received</th><th>Name</th><th>Mobile</th><th>Email</th><th>Message</th><th>Status</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id}>
                <td className="small">{when(r.createdAt)}</td><td className="small">{r.name}{r.orgId && <span className="tiny muted"> (customer)</span>}</td>
                <td className="small mono">{r.mobile}</td><td className="small">{r.email ?? "—"}</td><td className="small" style={{ maxWidth: 320 }}>{r.message ?? "—"}</td>
                <td>{write ? (
                  <form action={setHelpRequestStatus} className="row" style={{ gap: 4 }}><input type="hidden" name="id" value={r.id} />
                    <select name="status" defaultValue={r.status} className="input select" style={{ height: 30, fontSize: 12 }} aria-label="Status"><option value="new">New</option><option value="contacted">Contacted</option><option value="closed">Closed</option></select>
                    <button className="btn btn-sm btn-outline">Save</button></form>
                ) : <span className="chip c-draft">{r.status}</span>}</td>
              </tr>
            ))}</tbody></table></div>
        )}
      </>
    );
  }

  const conds: SQL[] = [];
  if (sp.status && ["draft", "live", "paused", "suspended"].includes(sp.status)) conds.push(eq(schema.stores.status, sp.status));
  if (sp.step && /^[1-7]$/.test(sp.step)) conds.push(eq(schema.stores.onboardingStep, Number(sp.step)));
  const q = sp.q?.trim().replace(/[%_]/g, "").slice(0, 60);
  if (q) conds.push(or(ilike(schema.stores.name, `%${q}%`), ilike(schema.stores.slug, `%${q}%`), ilike(schema.orgs.businessName, `%${q}%`))!);
  const rows = await db.select({
    s: schema.stores, org: schema.orgs.businessName,
    products: sql<number>`(select count(*)::int from ${schema.storeProducts} where ${schema.storeProducts.storeId} = ${schema.stores.id} and ${schema.storeProducts.status} = 'active')`,
    domains: sql<number>`(select count(*)::int from ${schema.storeDomains} where ${schema.storeDomains.storeId} = ${schema.stores.id})`,
  }).from(schema.stores).innerJoin(schema.orgs, eq(schema.orgs.id, schema.stores.orgId)).where(conds.length ? and(...conds) : undefined).orderBy(desc(schema.stores.updatedAt)).limit(300);
  const counts = await db.select({ status: schema.stores.status, n: sql<number>`count(*)::int` }).from(schema.stores).groupBy(schema.stores.status);
  const cnt = (k: string) => counts.find((c) => c.status === k)?.n ?? 0;

  return (
    <>
      <div className="page-h"><div><h1>Online Stores</h1><p className="small muted" style={{ margin: "4px 0 0" }}>Merchant storefronts: onboarding progress, status, domains and custom designs. Every admin change is in the audit log.</p></div></div>
      {tabs}{notes}
      <form className="card mb12 row wrap" style={{ padding: 12, gap: 8, alignItems: "flex-end" }} role="search">
        <div className="field"><label htmlFor="q">Search</label><input id="q" name="q" className="input" defaultValue={sp.q ?? ""} placeholder="Store, link or customer" /></div>
        <div className="field"><label htmlFor="st">Status</label><select id="st" name="status" className="input select" defaultValue={sp.status ?? ""}>
          <option value="">All ({counts.reduce((a, c) => a + c.n, 0)})</option>{["live", "draft", "paused", "suspended"].map((k) => <option key={k} value={k}>{k} ({cnt(k)})</option>)}</select></div>
        <div className="field"><label htmlFor="sp">Onboarding step</label><select id="sp" name="step" className="input select" defaultValue={sp.step ?? ""}><option value="">Any</option>{[1, 2, 3, 4, 5, 6, 7].map((n) => <option key={n} value={n}>At step {n}</option>)}</select></div>
        <button className="btn btn-outline">Filter</button>
      </form>
      {rows.length === 0 ? <div className="card empty"><p className="muted">No stores match.</p></div> : (
        <div className="card p0 tbl-wrap"><table className="tbl"><thead><tr><th>Store</th><th>Customer</th><th>Status</th><th>Onboarding</th><th>Products</th><th>Domains</th><th>Theme</th><th>Updated</th></tr></thead>
          <tbody>{rows.map(({ s, org, products, domains }) => (
            <tr key={s.id}>
              <td className="small"><a className="link-navy" href={`/admin/online-stores/${s.id}/`}><b>{s.name}</b></a><div className="tiny muted mono">/s/{s.slug}</div></td>
              <td className="small">{org}</td>
              <td><span className={`chip ${STATUS_CHIP[s.status] ?? "c-draft"}`}>{s.status}</span></td>
              <td className="small">{(s.stepsDone as number[]).length}/7 · at step {s.onboardingStep}</td>
              <td className="small">{products}</td><td className="small">{domains}</td>
              <td className="small">{s.themeKey}{s.customDesign && <span className="tiny muted"> · custom</span>}</td>
              <td className="small">{when(s.updatedAt)}</td>
            </tr>
          ))}</tbody></table></div>
      )}
    </>
  );
}
