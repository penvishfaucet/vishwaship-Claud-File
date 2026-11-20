import { Fragment } from "react";
import { notFound } from "next/navigation";
import { rupees } from "@/lib/store-themes";
import { OrderActions } from "@/components/portal/store/StoreOps";
import { FULFILMENT_LABEL, PAYMENT_LABEL, storeOrderForOrg } from "@/server/store/orders";
import { requireStorePage } from "@/server/store/portal";
import "@/styles/store.css";

export const metadata = { title: "Store order — Vishwaship" };
const COD_LABEL = { not_cod: "—", payable: "To be collected at delivery", collected: "Collected by courier (awaiting remittance)", remitted: "Remitted to you" } as const;

export default async function StoreOrderDetail({ params }: { params: Promise<{ id: string }> }) {
  const { ctx } = await requireStorePage();
  const { id } = await params;
  const o = await storeOrderForOrg(ctx.org.id, id);
  if (!o) notFound();
  const canCancel = o.status !== "cancelled" && o.fulfilment === "unfulfilled";
  return (
    <>
      <div className="page-h">
        <div><p className="small muted" style={{ margin: 0 }}><a href="/portal/store/orders/">Store orders</a></p><h1>Order {o.number}</h1>
          <p className="small muted" style={{ margin: "4px 0 0" }}>{o.createdAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}{o.status === "cancelled" && <> · <span className="red">Cancelled{o.note ? `: ${o.note}` : ""}</span></>}</p></div>
        <OrderActions id={o.id} status={o.status} paymentStatus={o.paymentStatus} shippingOrderId={o.shippingOrderId} canCancel={canCancel} />
      </div>
      <div className="grid2" style={{ alignItems: "start" }}>
        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ fontSize: 14, marginBottom: 8 }}>Items</h3>
          <table className="os-dns"><tbody>
            {o.lines.map((l, i) => <tr key={i}><td>{l.title}{l.variantTitle ? <span className="muted"> ({l.variantTitle})</span> : null}{l.sku && <div className="tiny muted">SKU {l.sku}</div>}</td><td>× {l.qty}</td><td style={{ textAlign: "right" }}>{rupees(l.unitPaise * l.qty)}</td></tr>)}
            <tr><td colSpan={2}>Subtotal</td><td style={{ textAlign: "right" }}>{rupees(o.subtotalPaise)}</td></tr>
            {o.discountPaise > 0 && <tr><td colSpan={2}>Discount {o.couponCode && <span className="mono">({o.couponCode})</span>}</td><td style={{ textAlign: "right" }}>− {rupees(o.discountPaise)}</td></tr>}
            <tr><td colSpan={2}>Shipping charged</td><td style={{ textAlign: "right" }}>{rupees(o.shippingPaise)}</td></tr>
            {o.codFeePaise > 0 && <tr><td colSpan={2}>COD fee</td><td style={{ textAlign: "right" }}>{rupees(o.codFeePaise)}</td></tr>}
            <tr><td colSpan={2}><b>Total</b></td><td style={{ textAlign: "right" }}><b>{rupees(o.totalPaise)}</b></td></tr>
          </tbody></table>
        </div>
        <div style={{ display: "grid", gap: 12 }}>
          <div className="card" style={{ padding: 16 }}>
            <h3 style={{ fontSize: 14, marginBottom: 8 }}>Status</h3>
            <dl className="kv-list">
              <dt>Payment</dt><dd>{PAYMENT_LABEL[o.paymentStatus] ?? o.paymentStatus}{o.paidAt ? ` · ${o.paidAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}` : ""}</dd>
              <dt>Delivery</dt><dd>{FULFILMENT_LABEL[o.fulfilment]}{o.trackingLabel ? ` · ${o.trackingLabel}` : ""}</dd>
              {o.awb && <><dt>AWB</dt><dd className="mono">{o.carrierName} · {o.awb}</dd></>}
              {o.paymentMethod === "cod" && <><dt>COD money</dt><dd>{COD_LABEL[o.cod]}</dd></>}
              {o.shippingOrderId && <><dt>Shipment</dt><dd><a className="orange" href={`/portal/orders/${o.shippingOrderId}/`}>Open in Orders</a></dd></>}
            </dl>
            {o.paymentStatus === "refund_due" && <p className="small red" style={{ marginBottom: 0 }}>This order was paid online and then cancelled. Refund the buyer from your Razorpay dashboard, then mark it refunded.</p>}
          </div>
          <div className="card" style={{ padding: 16 }}>
            <h3 style={{ fontSize: 14, marginBottom: 8 }}>Buyer</h3>
            <p className="small" style={{ margin: 0 }}><b>{o.buyer.name}</b> · {o.buyer.mobile}{o.buyer.email ? ` · ${o.buyer.email}` : ""}<br />{[o.buyer.line1, o.buyer.line2, `${o.buyer.city}, ${o.buyer.state} ${o.buyer.pincode}`].filter(Boolean).join(", ")}</p>
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
