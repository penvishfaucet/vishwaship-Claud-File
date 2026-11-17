import { redirect } from "next/navigation";
import { and, eq, or } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { portalContext } from "@/server/portal/context";

export default async function PortalTrack({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  const ctx = await portalContext();
  let notFoundMsg = false;
  if (q) {
    const db = await getDb();
    const v = q.trim().toUpperCase();
    const [s] = await db.select({ orderId: schema.shipments.orderId }).from(schema.shipments)
      .where(and(eq(schema.shipments.orgId, ctx.org.id), or(eq(schema.shipments.awb, v), eq(schema.shipments.lrNumber, v))));
    if (s) redirect(`/portal/orders/${s.orderId}/`);
    notFoundMsg = true;
  }
  return (
    <>
      <div className="page-h"><h1>Track Shipment</h1></div>
      <form className="card row wrap" style={{ padding: 16, gap: 8, maxWidth: 640 }} role="search">
        <label htmlFor="tq" className="sr-only">AWB or LR number</label>
        <input id="tq" name="q" className="input" defaultValue={q} placeholder="AWB / LR number" required style={{ flex: 1, minWidth: 200 }} />
        <button className="btn btn-orange">Track</button>
      </form>
      {notFoundMsg && <p className="mt12 muted" role="status">No shipment in your account matches “{q}”. For other shipments use the <a className="link" href={`/track/?awb=${encodeURIComponent(q!)}`}>public tracker</a>.</p>}
    </>
  );
}
