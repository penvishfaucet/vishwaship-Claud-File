import { CheckCircle2, Clock, XCircle } from "lucide-react";
import { notFound } from "next/navigation";
import { rupees } from "@/lib/store-themes";
import { StoreShell } from "@/components/store/Storefront";
import { ClearCartOnMount } from "@/components/store/StoreClient";
import { TrackOnMount } from "@/components/store/Tracking";
import { purchaseEventId } from "@/server/store/marketing";
import { FULFILMENT_LABEL, PAYMENT_LABEL, buyerOrder } from "@/server/store/orders";
import { type SfSearch, resolveSf, sfMeta } from "../../_sf";

export const dynamic = "force-dynamic";
type P = Promise<{ slug: string; number: string }>;

export async function generateMetadata({ params, searchParams }: { params: P; searchParams: SfSearch }) {
  const m = await sfMeta(await resolveSf(params, searchParams), "/", "Your order");
  return { ...m, robots: { index: false, follow: false } };
}

export default async function OrderConfirmation({ params, searchParams }: { params: P; searchParams: SfSearch }) {
  const sf = await resolveSf(params, searchParams);
  const { number } = await params;
  const sp = await searchParams;
  const t = sp.t;
  const o = sf.demo ? null : await buyerOrder(sf.id, decodeURIComponent(number), typeof t === "string" ? t : "");
  if (!o) notFound();
  const waiting = o.status === "pending_payment";
  const Icon = o.status === "cancelled" ? XCircle : waiting ? Clock : CheckCircle2;
  return (
    <StoreShell sf={sf}>
      <div className="sf-wrap sf-page" style={{ maxWidth: 760 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 8 }}>
          <Icon size={36} aria-hidden style={{ color: o.status === "cancelled" ? "#b42318" : "var(--sf-primary)" }} />
          <div>
            <h1 style={{ margin: 0 }}>{o.status === "cancelled" ? "Order cancelled" : waiting ? "Waiting for payment" : "Thank you! Your order is placed."}</h1>
            <p className="sf-note" style={{ margin: 0 }}>Order <b>{o.number}</b> · {new Date(o.createdAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</p>
          </div>
        </div>
        {waiting && sp.pay === "failed" && <p role="alert" style={{ color: "#b42318", fontWeight: 600 }}>The payment did not go through. No money was taken for this order. <a href={`${sf.base}/checkout/`} style={{ textDecoration: "underline" }}>Try paying again</a></p>}
        {waiting && sp.pay !== "failed" && <p className="sf-note">If you completed the payment, it will be confirmed here within a few minutes. Refresh this page to check. <a href={`${sf.base}/checkout/`} style={{ textDecoration: "underline" }}>Go back to payment</a></p>}
        {o.status === "placed" && <ClearCartOnMount store={sf.slug} />}
        {o.paymentMethod === "cod" && o.status === "placed" && <p className="sf-note">Please keep {rupees(o.totalPaise)} ready at delivery. You may get a WhatsApp message to confirm your order.</p>}
        <div className="sf-summary" style={{ marginTop: 16 }}>
          <div className="row"><span>Payment</span><b>{PAYMENT_LABEL[o.paymentStatus] ?? o.paymentStatus}</b></div>
          <div className="row"><span>Delivery</span><b>{FULFILMENT_LABEL[o.fulfilment]}</b></div>
          {o.awb && <div className="row"><span>{o.carrierName}</span><a href={`${sf.base}/track/?awb=${encodeURIComponent(o.awb)}`} style={{ textDecoration: "underline" }}>Track {o.awb}</a></div>}
        </div>
        <div className="sf-summary" style={{ marginTop: 16 }}>
          {o.lines.map((l, i) => <div className="row" key={i}><span>{l.title}{l.variantTitle ? ` (${l.variantTitle})` : ""} × {l.qty}</span><span>{rupees(l.unitPaise * l.qty)}</span></div>)}
          <div className="row" style={{ borderTop: "1px solid var(--sf-line)", paddingTop: 10 }}><span>Subtotal</span><span>{rupees(o.subtotalPaise)}</span></div>
          {o.discountPaise > 0 && <div className="row"><span>Discount{o.couponCode ? ` (${o.couponCode})` : ""}</span><span>− {rupees(o.discountPaise)}</span></div>}
          <div className="row"><span>Shipping</span><span>{o.shippingPaise ? rupees(o.shippingPaise) : "Free"}</span></div>
          {o.codFeePaise > 0 && <div className="row"><span>COD fee</span><span>{rupees(o.codFeePaise)}</span></div>}
          <div className="row"><b>Total</b><b>{rupees(o.totalPaise)}</b></div>
        </div>
        <div className="sf-summary" style={{ marginTop: 16 }}>
          <b>Delivering to</b>
          <span>{o.buyer.name} · {o.buyer.mobile}</span>
          <span className="sf-note">{[o.buyer.line1, o.buyer.line2, `${o.buyer.city}, ${o.buyer.state} ${o.buyer.pincode}`].filter(Boolean).join(", ")}</span>
        </div>
        {o.status === "placed" && (o.paymentStatus === "paid" || (o.paymentMethod === "cod" && sf.tags.codMilestone === "placed")) && (
          <TrackOnMount onceKey={`sf-purchase:${o.id}`} event={{ name: "purchase", eventId: purchaseEventId(o.id), orderNumber: o.number, value: o.totalPaise / 100, items: o.lines.map((l) => ({ id: l.variantId ?? l.productId, name: l.title, price: l.unitPaise / 100, qty: l.qty })) }} />
        )}
        <p className="sf-note" style={{ marginTop: 16 }}>Save this page link to check your order later, or use <a href={`${sf.base}/track/`} style={{ textDecoration: "underline" }}>Track order</a> with your order number and mobile number.</p>
      </div>
    </StoreShell>
  );
}
