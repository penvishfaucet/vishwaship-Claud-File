import { FileDown } from "lucide-react";
import { requireStaff } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";

export default async function AdminReports() {
  await requireStaff("reports.export");
  const db = await getDb();
  const orgs = await db.select({ id: schema.orgs.id, name: schema.orgs.businessName }).from(schema.orgs);
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
  return (
    <>
      <div className="page-h"><h1>Reports</h1></div>
      <form className="card row wrap" style={{ padding: 16, gap: 10, alignItems: "end" }} action="/api/admin/export/shipments" method="get">
        <div className="field"><label htmlFor="r">Report</label><select id="r" name="r" className="select"><option value="shipments">Shipments + revenue / cost / margin</option></select></div>
        <div className="field"><label htmlFor="org">Customer</label><select id="org" name="org" className="select"><option value="">All customers</option>{orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></div>
        <div className="field"><label htmlFor="prov">Provider</label><select id="prov" name="provider" className="select"><option value="">All</option><option value="shipmozo">Shipmozo</option><option value="demo">Demo</option></select></div>
        <div className="field"><label htmlFor="from">From (IST)</label><input id="from" name="from" type="date" className="input" defaultValue={monthAgo} /></div>
        <div className="field"><label htmlFor="to">To (IST)</label><input id="to" name="to" type="date" className="input" defaultValue={today} /></div>
        <div className="field"><label htmlFor="fmt">Format</label><select id="fmt" name="format" className="select"><option value="xlsx">Excel (.xlsx)</option><option value="csv">CSV</option></select></div>
        <button className="btn btn-orange"><FileDown size={16} /> Export</button>
      </form>
      <p className="tiny muted mt8">Cost and margin columns are included only for roles with cost access. Every export is recorded in the audit log.</p>
    </>
  );
}
