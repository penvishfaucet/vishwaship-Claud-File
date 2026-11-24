import { Fragment } from "react";
import { notFound } from "next/navigation";
import { rupees } from "@/lib/store-themes";
import { OrderActions, ReturnDecision } from "@/components/portal/store/StoreOps";
import { RETURN_STATUS_LABEL } from "@/server/store/returns";
import { orderTimeline } from "@/server/store/ops";
import { PAYMENT_LABEL, STAGE_LABEL, storeOrderForOrg } from "@/server/store/orders";
import { REFUND_LABEL } from "@/server/store/refunds";
import { requireStorePage } from "@/server/store/portal";
import "@/styles/store.css";

export const metadata = { title: "Store order — Vishwaship" };
const COD_LABEL = { not_cod: "—", payable: "To be collected at delivery", collected: "Collected by courier (awaiting remittance)", remitted: "Remitted to you" } as const;
const ist = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default async function StoreOrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requireStorePage();
  const { id } = await params;
  const o = await storeOrderForOrg(ctx.org.id, id);
  if (!o) notFound();
  const timeline = await orderTimeline(ctx.org.id, o.id);
  const canCancel = o.status === "placed" && o.acceptance === "accepted" && o.fulfilment === "unfulfilled";
  const prepaid = o.paymentMethod !== "cod";
  return (
    <>
      <div className="page-h">
        <div><p className="small muted" style={{ margin: 0 }}><a href="/portal/store/orders/">Store orders</a></p><h1>Order {o.number}</h1>
          <p className="small" style={{ margin: "4px 0 0" }}><span className={`chip ${["rejected", "cancelled", "payment_failed"].includes(o.stage) ? "c-cancelled" : o.stage === "pending_acceptance" ? "c-draft" : "c-active"}`}>{STAGE_LABEL[o.stage]}</span>
            {" "}<span className="muted">{ist(o.placedAt ?? o.createdAt)}</span></p>
          {o.status === "cancelled" && (o.rejectReason || o.note) && <p className="small red" style={{ margin: "4px 0 0" }}>{o.acceptance === "rejected" ? "Rejected" : "Cancelled"}: {o.rejectReason ?? o.note}</p>}
        </div>
        <OrderActions id={o.id} stage={o.stage} paymentStatus={o.paymentStatus} shippingOrderId={o.shippingOrderId} canCancel={canCancel} prepaid={prepaid} refundStatus={o.refund?.status ?? null} />
      </div>
      {o.returnRequest && (() => {
        const rr = o.returnRequest;
        return (
          <div className="card mb12" style={{ padding: 16, borderLeft: `4px solid ${rr.status === "requested" ? "#e5540c" : rr.status === "rejected" ? "#b42318" : "#15803d"}` }}>
            <h2 className="h3" style={{ margin: 0 }}>{rr.type === "exchange" ? "Exchange" : "Return"} request · {RETURN_STATUS_LABEL[rr.status]}</h2>
            <p className="small" style={{ margin: "6px 0 0" }}><b>Reason:</b> {rr.reason}{rr.note ? ` — ${rr.note}` : ""}</p>
            <p className="small" style={{ margin: "4px 0 0" }}><b>Items:</b> {rr.lines.map((l) => { const x = o.lines[l.index]; return x ? `${x.title}${x.variantTitle ? ` (${x.variantTitle})` : ""} × ${l.qty}` : ""; }).filter(Boolean).join(", ")}</p>
            <p className="tiny muted" style={{ margin: "4px 0 0" }}>Asked {ist(new Date(rr.requestedAt))}{rr.merchantNote ? ` · Your note: ${rr.merchantNote}` : ""}</p>
            {rr.status === "approved" && <p className="small muted" style={{ margin: "6px 0 0" }}>Book the pickup with <a className="link" href="/portal/orders/new/?direction=reverse">Create return</a>, check the goods on <a className="link" href={`/portal/store/inventory/?return=${o.id}`}>Inventory</a>, refund from your payment gateway if needed, then mark it completed.</p>}
            <ReturnDecision id={o.id} status={rr.status} />
          </div>
        );
      })()}
      <div className="grid2" style={{ alignItems: "start" }}>
        <div style={{ display: "grid", gap: 12 }}>
          <div className="card" style={{ padding: 16 }}>
            <h3 style={{ fontSize: 14, marginBottom: 8 }}>Items ({o.items})</h3>
            <table className="os-dns"><tbody>
              {o.lines.map((l, i) => <tr key={i}><td>{l.title}{l.variantTitle ? <span className="muted"> ({l.variantTitle})</span> : null}{l.sku && <div className="tiny muted">SKU {l.sku}</div>}</td><td style={{ whiteSpace: "nowrap" }}>× {l.qty}</td><td style={{ textAlign: "right" }}>{rupees(l.unitPaise * l.qty)}</td></tr>)}
              <tr><td colSpan={2}>Subtotal</td><td style={{ textAlign: "right" }}>{rupees(o.subtotalPaise)}</td></tr>
              {o.discountPaise > 0 && <tr><td colSpan={2}>Discount {o.couponCode && <span className="mono">({o.couponCode})</span>}</td><td style={{ textAlign: "right" }}>− {rupees(o.discountPaise)}</td></tr>}
              <tr><td colSpan={2}>Shipping collected from buyer</td><td style={{ textAlign: "right" }}>{rupees(o.shippingPaise)}</td></tr>
              {o.codFeePaise > 0 && <tr><td colSpan={2}>COD fee</td><td style={{ textAlign: "right" }}>{rupees(o.codFeePaise)}</td></tr>}
              <tr><td colSpan={2}><b>Total</b></td><td style={{ textAlign: "right" }}><b>{rupees(o.totalPaise)}</b></td></tr>
            </tbody></table>
          </div>
          <div className="card" style={{ padding: 16 }}>
            <h3 style={{ fontSize: 14, marginBottom: 10 }}>Timeline</h3>
            {timeline.length ? (
              <ol className="so-timeline">
                {timeline.map((e, i) => <li key={i}><div><div>{e.message}</div><div className="tiny muted">{ist(e.at)}{e.actor ? ` · ${e.actor}` : ""}</div></div></li>)}
              </ol>
            ) : <p className="small muted" style={{ margin: 0 }}>Placed {ist(o.placedAt ?? o.createdAt)}. (Orders from before the timeline show their history in Orders.)</p>}
          </div>
        </div>
        <div style={{ display: "grid", gap: 12 }}>
          <div className="card" style={{ padding: 16 }}>
            <h3 style={{ fontSize: 14, marginBottom: 8 }}>Status</h3>
            <dl className="kv-list">
              <dt>Payment</dt><dd>{prepaid ? `Prepaid (${o.paymentMethod}) · ${PAYMENT_LABEL[o.paymentStatus] ?? o.paymentStatus}` : o.status === "cancelled" ? "Cash on Delivery · nothing collected" : "Cash on Delivery"}{o.paidAt ? ` · ${ist(o.paidAt)}` : ""}</dd>
              {o.refund && <><dt>Refund</dt><dd>{REFUND_LABEL[o.refund.status]} · {rupees(o.refund.amountPaise)}{o.refund.gatewayRefundId ? <span className="tiny muted mono"> · {o.refund.gatewayRefundId}</span> : null}{o.refund.message && o.refund.status === "failed" ? <div className="tiny red">{o.refund.message}</div> : null}</dd></>}
              {o.acceptedAt && <><dt>Accepted</dt><dd>{ist(o.acceptedAt)}</dd></>}
              <dt>Delivery</dt><dd>{STAGE_LABEL[o.stage]}{o.trackingLabel ? ` · ${o.trackingLabel}` : ""}</dd>
              {o.awb && <><dt>AWB</dt><dd className="mono">{o.carrierName} · {o.awb}</dd></>}
              {o.paymentMethod === "cod" && o.acceptance === "accepted" && <><dt>COD money</dt><dd>{COD_LABEL[o.cod]}</dd></>}
              <dt>Stock</dt><dd>{o.stockState === "reserved" ? "Held for this order" : o.stockState === "deducted" ? "Deducted (goods left the warehouse)" : o.stockState === "released" ? "Returned to stock" : "—"}</dd>
              {o.shippingOrderId && <><dt>Shipment</dt><dd><a className="orange" href={`/portal/orders/${o.shippingOrderId}/`}>Open in Orders</a></dd></>}
              {o.returnInspectedAt && <><dt>Return</dt><dd>Counted {ist(o.returnInspectedAt)}</dd></>}
            </dl>
            {o.stockState === "deducted" && !o.returnInspectedAt && ["delivered", "rto_delivered"].includes(o.stage) && (
              <p className="small" style={{ marginBottom: 0 }}><a className="orange" href={`/portal/store/inventory/?return=${o.id}`}>{o.stage === "rto_delivered" ? "Count the returned goods" : "Record a customer return"}</a></p>
            )}
            {o.paymentStatus === "refund_due" && <p className="small red" style={{ marginBottom: 0 }}>The refund could not be made automatically. Refund the buyer from your payment gateway dashboard, then tap “Mark refunded”.</p>}
          </div>
          <div className="card" style={{ padding: 16 }}>
            <h3 style={{ fontSize: 14, marginBottom: 8 }}>Buyer</h3>
            <p className="small" style={{ margin: 0, overflowWrap: "anywhere" }}><b>{o.buyer.name}</b> · <a href={`tel:+91${o.buyer.mobile}`}>{o.buyer.mobile}</a>{o.buyer.email ? ` · ${o.buyer.email}` : ""}<br />{[o.buyer.line1, o.buyer.line2, `${o.buyer.city}, ${o.buyer.state} ${o.buyer.pincode}`].filter(Boolean).join(", ")}</p>
          </div>
          {Object.keys(o.attribution).some((k) => k.startsWith("utm_") || k === "fbclid" || k === "gclid" || k === "landing") && (
            <div className="card" style={{ padding: 16 }}>
              <h3 style={{ fontSize: 14, marginBottom: 8 }}>Came from</h3>
              <dl className="kv-list">{Object.entries(o.attribution).filter(([k]) => ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "fbclid", "gclid", "landing", "consent"].includes(k)).map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd style={{ wordBreak: "break-all" }}>{v}</dd></Fragment>)}</dl>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
