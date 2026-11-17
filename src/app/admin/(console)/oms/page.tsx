import { eq, inArray } from "drizzle-orm";
import { AdminOpForm } from "@/components/admin/AdminOpForm";
import { can } from "@/server/auth/rbac";
import { requireStaff } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";

export default async function AdminOms() {
  const s = await requireStaff("integrations.read");
  const write = can(s.role, "integrations.write");
  const db = await getDb();
  const rows = await db.select({ v: schema.orgSettings, name: schema.orgs.businessName }).from(schema.orgSettings).innerJoin(schema.orgs, eq(schema.orgs.id, schema.orgSettings.orgId)).where(eq(schema.orgSettings.key, "oms"));
  const st = rows.length ? await db.select().from(schema.orgSettings).where(inArray(schema.orgSettings.orgId, rows.map((r) => r.v.orgId))) : [];
  return (
    <>
      <div className="page-h"><div><h1>OMS Connections</h1><p className="small muted" style={{ margin: "4px 0 0" }}>Customer requests for Unicommerce / EasyEcom / Vinculum / Browntape connectors. Set the status customers see in Integrations → OMS.</p></div></div>
      {rows.length === 0 ? <div className="card empty"><p className="muted">No OMS requests yet.</p></div> : (
        <div className="card p0 tbl-wrap"><table className="tbl"><thead><tr><th>Customer</th><th>OMS</th><th>Account</th><th>Notes</th><th>Status</th></tr></thead>
          <tbody>{rows.map(({ v, name }) => {
            const o = v.value as { provider: string; accountName: string; notes?: string; pushShipmentUpdates?: boolean };
            const cur = st.find((x) => x.orgId === v.orgId && x.key === "oms_status")?.value as { status: string; note?: string } | undefined;
            return (
              <tr key={v.orgId}><td className="small b">{name}</td><td className="small">{o.provider}</td><td className="small">{o.accountName}{o.pushShipmentUpdates ? " · push updates" : ""}</td><td className="tiny">{o.notes || "—"}</td>
                <td><AdminOpForm op="oms_status" submit="Update" disabled={!write} fields={[{ name: "orgId", label: "", type: "hidden", value: v.orgId }, { name: "status", label: "Status", type: "select", value: cur?.status ?? "requested", options: [["requested", "Requested"], ["in_progress", "Being set up"], ["connected", "Connected"], ["rejected", "Not available"]] }, { name: "note", label: "Note to customer", value: cur?.note ?? "" }]} /></td></tr>
            );
          })}</tbody></table></div>
      )}
    </>
  );
}
