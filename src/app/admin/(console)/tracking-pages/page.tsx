import { desc, eq } from "drizzle-orm";
import { setTrackingPageDisabled } from "@/server/admin/module-actions";
import { can } from "@/server/auth/rbac";
import { requireStaff } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";

export default async function AdminTrackingPages({ searchParams }: { searchParams: Promise<{ ok?: string }> }) {
  const sp = await searchParams;
  const s = await requireStaff("customers.read");
  const write = can(s.role, "modules.manage");
  const db = await getDb();
  const rows = await db.select({ t: schema.trackingPages, org: schema.orgs.businessName }).from(schema.trackingPages).innerJoin(schema.orgs, eq(schema.orgs.id, schema.trackingPages.orgId)).orderBy(desc(schema.trackingPages.updatedAt));
  return (
    <>
      <div className="page-h"><div><h1>Branded Tracking Pages</h1><p className="small muted" style={{ margin: "4px 0 0" }}>Customer tracking pages. Disabling one takes it offline immediately (buyers see the standard Vishwaship tracking page instead); the customer cannot re-publish until you enable it.</p></div></div>
      {sp.ok && <p className="note small mb12">{sp.ok}</p>}
      {rows.length === 0 ? <div className="card empty"><p className="muted">No customer has created a tracking page yet.</p></div> : (
        <div className="card p0 tbl-wrap"><table className="tbl"><thead><tr><th>Customer</th><th>Public link</th><th>Status</th><th>Published</th><th>Updated</th>{write && <th />}</tr></thead>
          <tbody>{rows.map(({ t, org }) => (
            <tr key={t.orgId}>
              <td className="small">{org}</td>
              <td className="small mono"><a className="link-navy" href={`/t/${t.slug}`} target="_blank" rel="noreferrer">/t/{t.slug}</a></td>
              <td>{t.disabledByAdmin ? <span className="chip c-failed">Disabled by admin</span> : <span className={`chip ${t.isPublished ? "c-active" : "c-draft"}`}>{t.isPublished ? "Live" : "Draft only"}</span>}</td>
              <td className="small">{t.publishedAt?.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) ?? "—"}</td>
              <td className="small">{t.updatedAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</td>
              {write && <td><form action={setTrackingPageDisabled}><input type="hidden" name="orgId" value={t.orgId} /><input type="hidden" name="disabled" value={t.disabledByAdmin ? "0" : "1"} /><button className="btn btn-sm btn-outline">{t.disabledByAdmin ? "Enable" : "Disable"}</button></form></td>}
            </tr>
          ))}</tbody></table></div>
      )}
    </>
  );
}
