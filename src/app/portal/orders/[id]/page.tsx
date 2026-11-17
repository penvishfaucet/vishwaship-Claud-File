import { OrderTagsEditor } from "@/components/portal/OrderTagsEditor";
import { tagsForOrders } from "@/server/orders/extras";
import { asc as ascTags, eq as eqTags } from "drizzle-orm";
import { getDb as getDbTags, schema as schemaTags } from "@/server/db/client";
import { hasFeature } from "@/server/features";
import { CancelOrder } from "@/components/portal/CancelOrder";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, FileText, Ticket, Truck } from "lucide-react";
import { BookExisting } from "@/components/portal/BookExisting";
import { formatINR } from "@/lib/money";
import { carrierLogo } from "@/lib/site";
import { StatusChip, statusLabel } from "@/lib/status";
import { portalContext } from "@/server/portal/context";
import { getOrderDetail } from "@/server/portal/queries";

const fmt = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export default async function OrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await portalContext();
  const tagList = await (await getDbTags()).select({ id: schemaTags.orderTags.id, name: schemaTags.orderTags.name, color: schemaTags.orderTags.color }).from(schemaTags.orderTags).where(eqTags(schemaTags.orderTags.orgId, ctx.org.id)).orderBy(ascTags(schemaTags.orderTags.name));
  const d = await getOrderDetail(ctx.org.id, id); // tenant-scoped: other orgs' ids 404
  if (!d) notFound();
  const { order, pkgs, shipment, events, warehouse, quote } = d;
  const c = order.consignee as { name: string; mobile: string; line1: string; line2?: string; city: string; state: string; pincode: string };
  const products = order.products as Array<{ name: string; qty: number; unitPrice: number; hsn?: string }>;
  const priced = quote?.priced as { lines?: Array<{ label: string; sellPreTax: number }>; gst?: number; total?: number } | undefined;
  const boxes = pkgs.reduce((s, p) => s + p.count, 0);
  const actual = pkgs.reduce((s, p) => s + p.count * p.actualWeightGrams, 0);
  const vol = pkgs.reduce((s, p) => s + p.count * Math.ceil((p.lengthMm * p.breadthMm * p.heightMm) / 5000 / 1000), 0);
  const logo = shipment ? carrierLogo(shipment.carrierCode) : null;

  return (
    <>
      <div className="page-h">
        <div className="row wrap" style={{ gap: 12, alignItems: "center" }}>
          {logo && <img src={logo} alt={shipment!.carrierName} style={{ height: 30 }} />}
          <div>
            <h1>{order.orderNumber}</h1>
            <div className="small muted mono">{shipment?.awb ?? "Not booked yet"}{shipment?.lrNumber && shipment.lrNumber !== shipment.awb ? ` · LR ${shipment.lrNumber}` : ""}</div>
          </div>
          {shipment ? <StatusChip status={shipment.status} /> : <span className="chip c-draft">{order.status.replace(/_/g, " ")}</span>}
          {shipment?.provider === "demo" && <span className="demo-badge">DEMO</span>}
        </div>
        <div className="actions">
          {shipment && <a className="btn btn-orange" href={`/api/portal/shipments/${shipment.id}/label`}><Download size={16} /> Label</a>}
          {shipment && <a className="btn btn-outline" href={`/api/portal/shipments/${shipment.id}/invoice`}><FileText size={16} /> Invoice</a>}
          {shipment && shipment.pickupStatus === "not_scheduled" && <Link className="btn btn-outline" href={`/portal/orders/${order.id}/?pickup=1`}><Truck size={16} /> Schedule Pickup</Link>}
          {(!shipment ? ["draft", "ready", "cod_hold", "booking_failed"].includes(order.status) : shipment.bookingStatus === "confirmed" && ["booked", "pickup_pending"].includes(shipment.status)) && <CancelOrder orderId={order.id} booked={!!shipment} />}
          <Link className="btn btn-outline" href={`/portal/support/new/?awb=${shipment?.awb ?? ""}&order=${order.orderNumber}`}><Ticket size={16} /> Raise Ticket</Link>
        </div>
      </div>

      {!shipment && ["ready", "booking_failed", "cod_hold"].includes(order.status) && <BookExisting orderId={order.id} held={order.status === "cod_hold"} autoAssign={await hasFeature(ctx.org.id, "auto_assign")} />}
      <div className="mb12"><span className="small b" style={{ marginRight: 8 }}>Tags</span><OrderTagsEditor orderId={order.id} all={tagList} initial={(await tagsForOrders([order.id])).get(order.id)?.map((t) => t.id) ?? []} /></div>
      {order.source !== "manual" && <p className="tiny muted mb8">Source: {order.source}{order.externalOrderId ? ` · store order ${order.externalOrderId}` : ""}</p>}
      <div className="row wrap mb16" style={{ gap: 8 }}>
        <span className="pill2">Order: {order.status.replace(/_/g, " ")}</span>
        <span className="pill2">Booking: {shipment?.bookingStatus ?? "—"}</span>
        <span className="pill2">Pickup: {shipment?.pickupStatus.replace(/_/g, " ") ?? "—"}</span>
        <span className="pill2">Label: {shipment?.labelStatus.replace(/_/g, " ") ?? "—"}</span>
      </div>

      <div className="split-2-1" style={{ alignItems: "start" }}>
        <div className="col" style={{ gap: 14 }}>
          <div className="grid2" style={{ gap: 14 }}>
            <section className="card" style={{ padding: 16 }}>
              <h2 className="b small" style={{ marginTop: 0 }}>Pickup</h2>
              {(() => { const p = (order.pickupSnapshot as { label: string; line1: string; city: string; state: string; pincode: string } | null) ?? warehouse; return p ? <p className="small" style={{ margin: 0 }}>{p.label}<br />{p.line1}<br />{p.city}, {p.state} {p.pincode}</p> : <p className="muted small">—</p>; })()}
            </section>
            <section className="card" style={{ padding: 16 }}>
              <h2 className="b small" style={{ marginTop: 0 }}>Deliver to</h2>
              <p className="small" style={{ margin: 0 }}>{c.name} · {c.mobile}<br />{c.line1}{c.line2 ? `, ${c.line2}` : ""}<br />{c.city}, {c.state} {c.pincode}</p>
            </section>
          </div>
          <section className="card p0">
            <h2 className="b small card-h" style={{ margin: 0 }}>Products</h2>
            <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Item</th><th>HSN</th><th>Qty</th><th>Unit price</th></tr></thead>
              <tbody>{products.map((p, i) => <tr key={i}><td>{p.name}</td><td>{p.hsn ?? "—"}</td><td>{p.qty}</td><td>{formatINR(p.unitPrice)}</td></tr>)}</tbody></table></div>
          </section>
          <section className="card p0">
            <h2 className="b small card-h" style={{ margin: 0 }}>Packages</h2>
            <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Boxes</th><th>L × B × H (cm)</th><th>Actual / box</th><th>Volumetric / box</th></tr></thead>
              <tbody>{pkgs.map((p) => <tr key={p.id}><td>{p.count}</td><td>{p.lengthMm / 10} × {p.breadthMm / 10} × {p.heightMm / 10}</td><td>{(p.actualWeightGrams / 1000).toFixed(2)} kg</td><td>{((p.lengthMm * p.breadthMm * p.heightMm) / 5000 / 1000 / 1000).toFixed(2)} kg</td></tr>)}</tbody></table></div>
          </section>
        </div>
        <aside className="col" style={{ gap: 14 }}>
          <section className="card" style={{ padding: 16 }}>
            <h2 className="b small" style={{ marginTop: 0 }}>Weights</h2>
            <dl className="kv-list">
              <dt>Boxes</dt><dd>{boxes}</dd>
              <dt>Actual</dt><dd>{(actual / 1000).toFixed(2)} kg</dd>
              <dt>Volumetric</dt><dd>{(vol / 1000).toFixed(2)} kg</dd>
              <dt>Chargeable (quoted)</dt><dd>{shipment ? `${(shipment.chargeableWeightGrams / 1000).toFixed(2)} kg` : "—"}</dd>
              <dt>Carrier re-weigh</dt><dd>{shipment?.carrierWeightGrams ? `${(shipment.carrierWeightGrams / 1000).toFixed(2)} kg` : "Not reported"}</dd>
            </dl>
          </section>
          <section className="card" style={{ padding: 16 }}>
            <h2 className="b small" style={{ marginTop: 0 }}>Payment &amp; charges</h2>
            <dl className="kv-list">
              <dt>Payment</dt><dd>{order.paymentType === "cod" ? `COD · collect ${formatINR(order.codAmountPaise)}` : "Prepaid"}</dd>
              <dt>Declared value</dt><dd>{formatINR(order.declaredValuePaise)}</dd>
              {priced?.lines?.map((l) => <><dt key={`${l.label}-t`}>{l.label}</dt><dd key={`${l.label}-v`}>{formatINR(l.sellPreTax)}</dd></>)}
              {priced?.gst !== undefined && <><dt>GST</dt><dd>{formatINR(priced.gst)}</dd></>}
              {shipment && <><dt>Shipping charge</dt><dd style={{ color: "var(--orange)" }}>{formatINR(shipment.sellPaise)}</dd></>}
            </dl>
          </section>
          <section className="card" style={{ padding: 16 }}>
            <h2 className="b small" style={{ marginTop: 0 }}>Documents</h2>
            {shipment ? (
              <ul className="plain-list" style={{ margin: "0 -16px" }}>
                {[["thermal_4x6", "Label · thermal 4×6 in"], ["a4", "Label · A4"], ["thermal_3x4", "Label · thermal 3×4 in"], ["thermal_4x4", "Label · thermal 4×4 in"], ["thermal_2x4", "Label · thermal 2×4 in"], ["thermal_38x100", "Label · 38×100 mm"]].map(([f, l]) => (
                  <li key={f}><a className="link-navy small" href={`/api/portal/shipments/${shipment.id}/label?format=${f}`}>{l}</a></li>
                ))}
                <li><a className="link-navy small" href={`/api/portal/shipments/${shipment.id}/invoice`}>Invoice</a></li>
                {order.mode === "B2B" && <li><span className="small muted">LR / docket copy — available from the carrier after manifest</span></li>}
              </ul>
            ) : <p className="small muted">Available after booking.</p>}
          </section>
        </aside>
      </div>

      <section className="card mt16" style={{ padding: 16 }}>
        <h2 className="b small" style={{ marginTop: 0 }}>Tracking</h2>
        {events.length === 0 ? <p className="small muted">No scans yet.</p> : (
          <ol className="trk-tl">
            {events.map((e, i) => <li key={e.id} className={i === 0 ? "cur" : ""}><span className="b small">{statusLabel(e.status)}{e.location ? <span className="muted"> · {e.location}</span> : null}</span><span className="tiny muted">{fmt(e.occurredAt)}</span></li>)}
          </ol>
        )}
      </section>
    </>
  );
}
