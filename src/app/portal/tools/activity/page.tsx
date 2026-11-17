import Link from "next/link";
import { and, desc, eq, gte, ilike, inArray, lte } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { range } from "@/server/billing";
import { portalContext } from "@/server/portal/context";

const LABEL: Record<string, string> = {
  "order.create": "Order created", "order.update": "Order edited", "order.cancel": "Order cancelled", "booking.created": "Shipment booked", "booking.failed": "Booking failed", "booking.ambiguous": "Booking pending confirmation", "orders.bulk_import": "Bulk import", "store.sync": "Store sync", "store.connect": "Store connected", "store.disconnect": "Store disconnected", "credits.purchase": "Credits purchased", "recharge.credited": "Wallet recharged", "auth.login": "Logged in", "ticket.create": "Ticket raised", "warehouse.mobile_verified": "Pickup mobile verified",
  "shipment.cancel": "Cancellation requested", "ndr.action": "NDR action", "warehouse.create": "Warehouse added", "warehouse.update": "Warehouse edited", "warehouse.set_default": "Default warehouse",
  "warehouse.deactivate": "Warehouse deactivated", "warehouse.activate": "Warehouse activated", "report.export": "Report downloaded", export: "Export downloaded", "notifications.update": "Notification setting",
  "api_key.create": "API key created", "api_key.revoke": "API key revoked", "api_key.rotate": "API key rotated", "cod.confirmed": "COD confirmed", "cod.rejected": "COD rejected", "cod.no_response": "COD no response",
  "tracking_page.publish": "Tracking page published", "tracking_page.unpublish": "Tracking page unpublished", "settings.update": "Settings changed",
};
const GROUPS: Record<string, string[]> = {
  orders: ["order.", "orders.", "booking.", "shipment.", "cod.", "ndr."], settings: ["settings.", "warehouse.", "notifications.", "tracking_page.", "courier", "assign"], billing: ["recharge", "credits", "export", "report."], integrations: ["store.", "webhook.", "api_key."], security: ["auth.", "api_key.", "customer.impersonate"],
};
const PAGE = 50;

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; type?: string; q?: string; page?: string }> }) {
  const sp = await searchParams;
  const ctx = await portalContext();
  const db = await getDb();
  const { from, to } = range(sp, 30);
  const page = Math.max(1, Number(sp.page ?? 1));
  const conds = [eq(schema.auditLog.orgId, ctx.org.id), gte(schema.auditLog.createdAt, from), lte(schema.auditLog.createdAt, to)];
  if (sp.q) conds.push(ilike(schema.auditLog.targetId, `%${sp.q.replace(/[%_]/g, "")}%`));
  let rows = await db.select().from(schema.auditLog).where(and(...conds)).orderBy(desc(schema.auditLog.createdAt)).limit(2000);
  if (sp.type && GROUPS[sp.type]) rows = rows.filter((r) => GROUPS[sp.type!].some((p) => r.action.startsWith(p)));
  const users = [...new Set(rows.map((r) => r.actorUserId).filter(Boolean))] as string[];
  const names = users.length ? await db.select({ id: schema.users.id, name: schema.users.name, isStaff: schema.users.staffRole }).from(schema.users).where(inArray(schema.users.id, users)) : [];
  const actor = (r: typeof rows[number]) => {
    if (r.actorKind === "system") return "Vishwaship (automatic)";
    if (r.actorKind === "api_key") return "API key";
    const u = names.find((n) => n.id === r.actorUserId);
    if (r.actorKind === "staff" || u?.isStaff) return "Vishwaship support";
    return u?.name ?? "Your team";
  };
  const shown = rows.slice((page - 1) * PAGE, page * PAGE);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const qs = (patch: Record<string, string | undefined>) => new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]).toString();
  const status = (a: string) => (/fail|reject|revoke|cancel/.test(a) ? "c-failed" : /create|confirm|publish|book/.test(a) ? "c-active" : "c-draft");
  return (
    <>
      <div className="page-h"><div><h1>Activity logs</h1><p className="small muted" style={{ margin: "4px 0 0" }}>Everything done on your account — by your team, the API, or Vishwaship — with time and reference.</p></div></div>
      <form className="card row wrap mb12" style={{ padding: 12, gap: 8, alignItems: "end" }}>
        <div className="field"><label htmlFor="af">From</label><input id="af" type="date" name="from" className="input" defaultValue={sp.from ?? from.toISOString().slice(0, 10)} /></div>
        <div className="field"><label htmlFor="at">To</label><input id="at" type="date" name="to" className="input" defaultValue={sp.to ?? to.toISOString().slice(0, 10)} /></div>
        <div className="field"><label htmlFor="ty">Type</label><select id="ty" name="type" className="select" defaultValue={sp.type ?? ""}><option value="">All activity</option><option value="orders">Orders &amp; shipments</option><option value="settings">Settings</option><option value="billing">Billing &amp; exports</option><option value="security">Security &amp; API</option></select></div>
        <div className="field"><label htmlFor="aq">Reference</label><input id="aq" name="q" className="input" defaultValue={sp.q} placeholder="Order / shipment ID" /></div>
        <button className="btn btn-navy">Apply</button><Link className="btn btn-outline" href="/portal/tools/activity/">Reset</Link>
      </form>
      {shown.length === 0 ? <div className="card empty"><p className="muted">No activity for these filters.</p></div> : (
        <div className="card p0 tbl-wrap"><table className="tbl">
          <thead><tr><th>Time</th><th>Activity</th><th>By</th><th>Reference</th><th>Status</th></tr></thead>
          <tbody>{shown.map((r) => (
            <tr key={r.id}>
              <td className="small">{r.createdAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}</td>
              <td className="small">{LABEL[r.action] ?? r.action.replace(/[._]/g, " ")}</td>
              <td className="small">{actor(r)}</td>
              <td className="tiny mono">{r.targetType === "order" && r.targetId ? <Link className="link-navy" href={`/portal/orders/${r.targetId}/`}>{r.targetId}</Link> : r.targetId ?? "—"}</td>
              <td><span className={`chip ${status(r.action)}`}>{/fail|reject/.test(r.action) ? "Failed" : "Done"}</span></td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {pages > 1 && <nav className="row between mt12"><span className="small muted">Page {page} of {pages} · {rows.length} entries</span><span className="row" style={{ gap: 8 }}>{page > 1 && <Link className="btn btn-sm btn-outline" href={`?${qs({ page: String(page - 1) })}`}>Previous</Link>}{page < pages && <Link className="btn btn-sm btn-outline" href={`?${qs({ page: String(page + 1) })}`}>Next</Link>}</span></nav>}
    </>
  );
}
