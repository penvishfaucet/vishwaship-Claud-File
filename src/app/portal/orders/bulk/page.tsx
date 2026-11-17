import Link from "next/link";
import { and, eq } from "drizzle-orm";
import { BulkUpload } from "@/components/portal/BulkUpload";
import { getDb, schema } from "@/server/db/client";
import { portalContext } from "@/server/portal/context";
import { requireFeature } from "@/server/features";

export default async function BulkPage() {
  const ctx = await portalContext();
  await requireFeature(ctx.org.id, "bulk_upload");
  const db = await getDb();
  const wh = await db.select().from(schema.warehouses).where(and(eq(schema.warehouses.orgId, ctx.org.id), eq(schema.warehouses.active, true)));
  return (
    <>
      <div className="page-h">
        <div><Link className="small link-navy" href="/portal/orders/">← Orders</Link><h1>Bulk Upload</h1></div>
        <div className="actions">
          <a className="btn btn-outline" href="/api/portal/orders/bulk?template=csv">CSV template</a>
          <a className="btn btn-outline" href="/api/portal/orders/bulk?template=xlsx">Excel template</a>
        </div>
      </div>
      {wh.length === 0
        ? <div className="card empty"><p className="muted">Add a pickup address first.</p><Link className="btn btn-orange btn-sm" href="/portal/addresses/?add=1">Add Pickup Address</Link></div>
        : <BulkUpload warehouses={wh.map((w) => ({ id: w.id, label: `${w.label} — ${w.city} ${w.pincode}` }))} />}
    </>
  );
}
