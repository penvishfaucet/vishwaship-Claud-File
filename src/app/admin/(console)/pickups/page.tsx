import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { requireStaff } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";

export default async function Pickups() {
  await requireStaff("shipments.read");
  const db = await getDb();
  const rows = await db.select({ s: schema.shipments, o: schema.orgs, w: schema.warehouses }).from(schema.shipments)
    .innerJoin(schema.orgs, eq(schema.orgs.id, schema.shipments.orgId)).innerJoin(schema.orders, eq(schema.orders.id, schema.shipments.orderId)).leftJoin(schema.warehouses, eq(schema.warehouses.id, schema.orders.warehouseId))
    .where(inArray(schema.shipments.status, ["booked", "pickup_pending"])).orderBy(desc(schema.shipments.createdAt));
  return (
    <>
      <div className="page-h"><h1>Pickups</h1></div>
      {rows.length === 0 ? <div className="card empty"><p className="muted">No pickups pending.</p></div> : (
        <div className="card p0 tbl-wrap"><table className="tbl"><thead><tr><th>Customer</th><th>Warehouse</th><th>AWB</th><th>Carrier</th><th>Pickup status</th><th>Booked</th></tr></thead>
          <tbody>{rows.map(({ s, o, w }) => <tr key={s.id}><td className="small">{o.businessName}</td><td className="small">{w?.label} · {w?.city} {w?.pincode}</td><td><Link className="mono tiny link-navy" href={`/admin/shipments/${s.id}/`}>{s.awb}</Link></td><td className="small">{s.carrierName}</td><td><span className="chip c-pickup_pending">{s.pickupStatus}</span></td><td className="small">{s.createdAt.toLocaleString("en-IN")}</td></tr>)}</tbody></table></div>
      )}
    </>
  );
}
