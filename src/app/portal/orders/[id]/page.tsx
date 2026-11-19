import { CopyBtn } from "@/components/portal/orders/ui";
import { ShipmentDocs } from "@/components/portal/ManifestActions";
import { AwbLink, OrderIdLink, portalOrderHref, portalTrackHref } from "@/components/IdLinks";
import { SchedulePickup } from "@/components/portal/SchedulePickup";
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
import { AutoRefresh } from "@/components/portal/AutoRefresh";
import { labelFormatsFor } from "@/server/labels/formats";
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
  // volumetric grams per box = (L×B×H in cm³) / 5000 kg = mm³ / 5000 g
  const vol = pkgs.reduce((s, p) => s + p.count * Math.ceil((p.lengthMm * p.breadthMm * p.heightMm) / 5000), 0);
  const logo = shipment ? carrierLogo(shipment.carrierCode) : null;

  return (
    <>
      <div className="page-h">
        <div className="row wrap" style={{ gap: 12, alignItems: "center" }}>
          {logo && <img src={logo} alt={shipment!.carrierName} style={{ height: 30 }} />}
          <div>
            <h1>{order.orderNumber}</h1>
            <div className="small muted mono id-row">{shipment?.awb ? <><AwbLink value={shipment.awb} href={portalTrackHref(shipment.awb)} /><CopyBtn value={shipment.awb} label="AWB" /></> : "Not booked yet"}{shipment?.lrNumber && shipment.lrNumber !== shipment.awb ? ` · LR ${shipment.lrNumber}` : ""}</div>
          </div>
          {shipment ? <StatusChip status={shipment.status} /> : <span className="chip c-draft">{order.status.replace(/_/g, " ")}</span>}
          {shipment?.provider === "demo" && <span className="demo-badge">DEMO</span>}
        </div>
        <div className="actions">

          {shipment && <a className="btn btn-outline" href={`/api/portal/shipments/${shipment.id}/invoice`}><FileText size={16} /> Invoice</a>}
          {shipment && shipment.bookingStatus === "confirmed" && shipment.pickupStatus === "not_scheduled" && <SchedulePickup shipmentId={shipment.id} defaultDate={new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)} />}
          {shipment?.pickupRef && <span className="pill2">Pickup {shipment.pickupDate?.toLocaleDateString("en-IN")} · ref {shipment.pickupRef}</span>}
          {(!shipment ? ["draft", "ready", "cod_hold", "booking_failed"].includes(order.status) : shipment.bookingStatus === "confirmed" && ["booked", "pickup_pending"].includes(shipment.status)) && <CancelOrder orderId={order.id} booked={!!shipment} />}
          <Link className="btn btn-outline" href={`/portal/support/new/?awb=${shipment?.awb ?? ""}&order=${order.orderNumber}`}><Ticket size={16} /> Raise Ticket</Link>
        </div>
      </div>
      {shipment?.awb && shipment.status !== "cancelled" && <section className="card mb12" style={{ padding: 14 }} aria-label="Label and manifest"><ShipmentDocs shipmentId={shipment.id} awb={shipment.awb} formats={labelFormatsFor(shipment.provider)} /></section>}

      {(order.status === "booking" || order.status === "needs_reconcile" || (shipment && !["delivered", "rto_delivered", "cancelled", "lost"].includes(shipment.status))) && <AutoRefresh active everyMs={60_000} />}
      {shipment && (
        <section className="card mb16" style={{ padding: 16 }}>
          <div className="grid2" style={{ gap: 12 }}>
            <dl className="kv-list" style={{ margin: 0 }}>
              <dt>Courier</dt><dd>{shipment.carrierName} · {shipment.serviceName}{(quote?.priced as { partnerCode?: string } | undefined)?.partnerCode ? <span className="tiny muted"> · Partner code {(quote!.priced as { partnerCode: string }).partnerCode}</span> : null}</dd>
              <dt>{order.mode === "B2B" ? "LR / AWB" : "AWB"}</dt><dd className="mono">{shipment.awb ?? (shipment.bookingStatus === "pending" ? "Pending — the courier is assigning it; this page updates automatically" : "—")}{shipment.lrNumber && shipment.lrNumber !== shipment.awb ? ` · LR ${shipment.lrNumber}` : ""}</dd>
              {Array.isArray(shipment.pieceIds) && (shipment.pieceIds as string[]).length > 0 && <><dt>Package IDs</dt><dd className="mono tiny">{(shipment.pieceIds as string[]).join(", ")}</dd></>}
            </dl>
            <dl className="kv-list" style={{ margin: 0 }}>
              <dt>Pickup</dt><dd>{shipment.status === "picked_up" || ["in_transit", "at_delivery_center", "out_for_delivery", "delivered", "ndr"].includes(shipment.status) ? "Picked up (confirmed by courier scan)" : shipment.status === "cancelled" ? "Cancelled — no pickup" : shipment.pickupStatus === "scheduled" ? `Requested${shipment.pickupDate ? ` for ${shipment.pickupDate.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short" })}` : ""}${shipment.pickupRef ? ` · PR ${shipment.pickupRef}` : ""}` : <>Not requested yet · <Link className="link-navy" href="/portal/pickups/">Generate pickup request</Link></>}</dd>
              <dt>Pickup agent</dt><dd>{shipment.pickupAgentName || shipment.pickupAgentPhone ? <>{shipment.pickupAgentName ?? "Pickup agent"}{shipment.pickupAgentPhone && <> · <a className="link-navy b" href={`tel:+91${shipment.pickupAgentPhone}`}>Call {shipment.pickupAgentPhone}</a></>}</> : <span className="muted small">Shared by the courier when an agent is assigned</span>}</dd>
              <dt>Estimated delivery</dt><dd>{shipment.etaDate ? shipment.etaDate.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short" }) : "Not provided by the courier"}</dd>
              <dt>Tracking updated</dt><dd className="small">{shipment.lastSyncAt ? fmt(shipment.lastSyncAt) : shipment.lastEventAt ? fmt(shipment.lastEventAt) : "Waiting for first scan"}{shipment.lastLocation ? ` · ${shipment.lastLocation}` : ""}</dd>
            </dl>
          </div>
        </section>
      )}
      {!shipment && order.status === "draft" && <section className="card mb16 row between wrap" style={{ padding: 16, gap: 8 }}><span><b>Draft</b> <span className="small muted">— finish the details, then save it to assign a courier.</span></span><Link className="btn btn-orange btn-sm" href={`/portal/orders/new/?draft=${order.id}`}>Edit draft</Link></section>}
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
              <tbody>{pkgs.map((p) => <tr key={p.id}><td>{p.count}</td><td>{p.lengthMm / 10} × {p.breadthMm / 10} × {p.heightMm / 10}</td><td>{(p.actualWeightGrams / 1000).toFixed(2)} kg</td><td>{((p.lengthMm * p.breadthMm * p.heightMm) / 5000 / 1000).toFixed(2)} kg</td></tr>)}</tbody></table></div>
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
                {!shipment.awb ? <li><span className="small muted">Label — available once the courier assigns the AWB</span></li>
                  : <li><span className="small">Labels — use <b>Download Label</b> above (A4 2 / 4 per page, thermal sizes, or the courier&apos;s own label)</span>{shipment.provider === "shiporax" && <> · <a className="link-navy small" href={`/api/portal/shipments/${shipment.id}/label`}>Courier label</a></>}</li>}
                <li><a className="link-navy small" href={`/api/portal/shipments/${shipment.id}/invoice`}>Invoice</a></li>
                {order.mode === "B2B" && <li><span className="small muted">LR / docket copy — available from the carrier after manifest</span></li>}
              </ul>
            ) : <p className="small muted">Available after booking.</p>}
          </section>
        </aside>
      </div>

      <section className="card mt16" style={{ padding: 16 }}>
        <h2 className="b small" style={{ marginTop: 0 }}>Tracking</h2>
        {shipment?.lastLocation && <p className="small" style={{ marginTop: 0 }}>Last scanned at <b>{shipment.lastLocation}</b>{shipment.lastEventAt ? ` · ${fmt(shipment.lastEventAt)}` : ""}</p>}
        {events.length === 0 ? <p className="small muted">No scans yet.</p> : (
          <div className="tbl-wrap"><table className="tbl trk-table">
            <thead><tr><th>Date &amp; time</th><th>Status</th><th>Location</th><th>Courier update</th></tr></thead>
            <tbody>{events.map((e, i) => (
              <tr key={e.id} className={i === 0 ? "cur" : ""}>
                <td className="small" style={{ whiteSpace: "nowrap" }}>{fmt(e.occurredAt)}</td>
                <td className="small">{statusLabel(e.status)}</td>
                <td className="small">{e.location ?? "—"}</td>
                <td className="tiny muted">{e.rawStatus ?? ""}{e.remark && e.remark !== e.rawStatus ? ` · ${e.remark}` : ""}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
        <p className="tiny muted mt8">Scans update automatically from the courier (every 30 minutes, or instantly when the courier pushes them).</p>
      </section>
    </>
  );
}
