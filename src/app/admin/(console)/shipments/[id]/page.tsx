import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { formatINR } from "@/lib/money";
import { StatusChip, statusLabel } from "@/lib/status";
import { can } from "@/server/auth/rbac";
import { requireStaff } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";

export default async function AdminShipment({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireStaff("shipments.read");
  const db = await getDb();
  const [row] = await db.select({ s: schema.shipments, o: schema.orders, org: schema.orgs }).from(schema.shipments)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.shipments.orderId)).innerJoin(schema.orgs, eq(schema.orgs.id, schema.shipments.orgId)).where(eq(schema.shipments.id, id));
  if (!row) notFound();
  const { s: x, o, org } = row;
  const events = await db.select().from(schema.shipmentEvents).where(eq(schema.shipmentEvents.shipmentId, id)).orderBy(desc(schema.shipmentEvents.occurredAt));
  const pkgs = await db.select().from(schema.packages).where(eq(schema.packages.orderId, o.id));
  const [q] = await db.select().from(schema.quotes).where(eq(schema.quotes.id, x.quoteId));
  const priced = q?.priced as { markup?: { bps: number; source: string; ruleVersion: number }; costPreTax?: number; sellingSubtotal?: number; gst?: number } | undefined;
  const showCost = can(s.role, "shipments.cost.read");
  return (
    <>
      <div className="page-h">
        <div><Link className="small link-navy" href={`/admin/customers/${org.id}/`}>{org.businessName}</Link><h1>{o.orderNumber} <span className="mono small muted">{x.awb}</span></h1></div>
        <div className="actions"><StatusChip status={x.status} />{x.provider === "demo" && <span className="demo-badge">DEMO</span>}</div>
      </div>
      <div className="split-2-1" style={{ alignItems: "start" }}>
        <section className="card" style={{ padding: 16 }}>
          <h2 className="b small" style={{ marginTop: 0 }}>Operations</h2>
          <dl className="kv-list">
            <dt>Booking provider</dt><dd>{x.provider} ({x.providerAccountId})</dd><dt>Actual carrier</dt><dd>{x.carrierName} · {x.serviceName}</dd>
            <dt>Provider ref</dt><dd className="mono">{x.providerOrderRef ?? "—"}</dd><dt>LR / pieces</dt><dd className="mono">{x.lrNumber ?? "—"}{x.pieceIds ? ` · ${(x.pieceIds as string[]).length} pieces` : ""}</dd>
            <dt>Booking / pickup / label</dt><dd>{x.bookingStatus} / {x.pickupStatus} / {x.labelStatus}</dd>
            <dt>Boxes</dt><dd>{pkgs.reduce((t, p) => t + p.count, 0)}</dd><dt>Chargeable / carrier wt</dt><dd>{(x.chargeableWeightGrams / 1000).toFixed(2)} kg / {x.carrierWeightGrams ? `${(x.carrierWeightGrams / 1000).toFixed(2)} kg` : "—"}</dd>
          </dl>
        </section>
        <section className="card" style={{ padding: 16 }}>
          <h2 className="b small" style={{ marginTop: 0 }}>Finance</h2>
          <dl className="kv-list">
            <dt>Selling (incl. GST)</dt><dd>{formatINR(x.sellPaise)}</dd>
            {showCost ? <>
              <dt>Carrier cost (pre-tax)</dt><dd>{formatINR(x.costPaise)}</dd>
              <dt>Markup applied</dt><dd>{priced?.markup ? `${priced.markup.bps / 100}% (${priced.markup.source}, v${priced.markup.ruleVersion})` : "—"}</dd>
              <dt>Margin (pre-tax)</dt><dd>{priced?.sellingSubtotal !== undefined ? formatINR(priced.sellingSubtotal - x.costPaise) : "—"}</dd>
            </> : <><dt>Cost &amp; margin</dt><dd className="muted">Restricted</dd></>}
            <dt>Payment</dt><dd>{o.paymentType === "cod" ? `COD ${formatINR(o.codAmountPaise)}` : "Prepaid"}</dd>
          </dl>
        </section>
      </div>
      <section className="card mt16" id="tracking" style={{ padding: 16, scrollMarginTop: 80 }}>
        <h2 className="b small" style={{ marginTop: 0 }}>Event history</h2>
        <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Time (IST)</th><th>Status</th><th>Raw</th><th>Location</th><th>Source</th></tr></thead>
          <tbody>{events.map((e) => <tr key={e.id}><td className="small">{e.occurredAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</td><td>{statusLabel(e.status)}</td><td className="mono tiny">{e.rawStatus}</td><td className="small">{e.location}</td><td className="small">{e.source}</td></tr>)}</tbody></table></div>
      </section>
    </>
  );
}
