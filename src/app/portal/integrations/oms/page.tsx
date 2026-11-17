import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { OmsForm } from "@/components/portal/OmsForm";
import { orgSetting } from "@/server/couriers";
import { getDb, schema } from "@/server/db/client";
import { requireFeature } from "@/server/features";
import { portalContext } from "@/server/portal/context";

type Oms = { provider: string; accountName: string; pushShipmentUpdates: boolean; notes: string };
const STATUS: Record<string, [string, string]> = { requested: ["Requested", "c-pending"], in_progress: ["Being set up", "c-pending"], connected: ["Connected", "c-active"], rejected: ["Not available", "c-failed"] };

export default async function OmsPage() {
  const ctx = await portalContext();
  await requireFeature(ctx.org.id, "oms");
  const oms = await orgSetting<Oms>(ctx.org.id, "oms");
  const st = await orgSetting<{ status: string; note?: string }>(ctx.org.id, "oms_status");
  const db = await getDb();
  const synced = await db.select({ id: schema.orders.id, orderNumber: schema.orders.orderNumber, status: schema.orders.status, createdAt: schema.orders.createdAt, awb: schema.shipments.awb })
    .from(schema.orders).leftJoin(schema.shipments, eq(schema.shipments.orderId, schema.orders.id))
    .where(and(eq(schema.orders.orgId, ctx.org.id), eq(schema.orders.source, "api"))).orderBy(desc(schema.orders.createdAt)).limit(20);
  const [label, chip] = oms ? STATUS[st?.status ?? "requested"] ?? STATUS.requested : ["Not connected", "c-draft"];
  return (
    <>
      <div className="page-h">
        <div><h1>OMS</h1><p className="small muted" style={{ margin: "4px 0 0" }}>Connect your order management system so orders flow in and AWB / tracking flow back.</p></div>
        <div className="actions"><span className={`chip ${chip}`}>{label}</span></div>
      </div>
      <div className="split" style={{ gap: 16, alignItems: "start" }}>
        <section className="card" style={{ padding: 18 }}>
          <h2 className="b" style={{ fontSize: 15, marginTop: 0 }}>Native OMS connector</h2>
          <p className="small muted">Unicommerce, EasyEcom, Vinculum and Browntape connectors are enabled per account by Vishwaship with the OMS partner. Tell us your OMS and we will set it up.</p>
          {st?.note && <p className="small note">{st.note}</p>}
          <OmsForm initial={oms} />
        </section>
        <section className="card" style={{ padding: 18 }}>
          <h2 className="b" style={{ fontSize: 15, marginTop: 0 }}>Works today: API + webhook</h2>
          <ol className="small" style={{ paddingLeft: 18 }}>
            <li>Create an API key in <Link className="link" href="/portal/integrations/api/">API Integration</Link>.</li>
            <li>Point your OMS “custom shipping” connector at <code>POST /api/v1/orders</code> and <code>/api/v1/orders/&lt;id&gt;/book</code>.</li>
            <li>Add your OMS callback URL as the webhook to receive AWB and status updates.</li>
          </ol>
        </section>
      </div>
      <section className="card p0 mt16">
        <h2 className="b small card-h" style={{ margin: 0 }}>Synchronisation history (orders received by API)</h2>
        {synced.length === 0 ? <p className="small muted" style={{ padding: 16 }}>No orders received from an OMS or API yet.</p> : (
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Received</th><th>Order</th><th>Status</th><th>AWB sent back</th></tr></thead>
            <tbody>{synced.map((o) => <tr key={o.id}><td className="small">{o.createdAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</td><td className="small"><Link className="link-navy" href={`/portal/orders/${o.id}/`}>{o.orderNumber}</Link></td><td className="small">{o.status.replace(/_/g, " ")}</td><td className="small mono">{o.awb ?? "—"}</td></tr>)}</tbody></table></div>
        )}
      </section>
    </>
  );
}
