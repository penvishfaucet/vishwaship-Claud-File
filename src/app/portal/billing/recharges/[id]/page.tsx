import "@/styles/recharge.css";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { ArrowLeft } from "lucide-react";
import { AutoRefresh } from "@/components/portal/AutoRefresh";
import { RechargeInfoForm } from "@/components/portal/RechargeInfoForm";
import { getDb, schema } from "@/server/db/client";
import { reconcileRecharge } from "@/server/payments/reconcile";
import { portalContext } from "@/server/portal/context";
import { rateLimit } from "@/server/security/rate-limit";
import { formatINR } from "@/lib/money";
import { METHOD_LABEL, bpsLabel, rechargeStatus } from "@/lib/recharge";

export const dynamic = "force-dynamic";
const ist = (d: Date | null | undefined) => (d ? d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const CUSTOMER_EVENTS: Record<string, string> = {
  created: "Payment started", submitted: "Request submitted", info_requested: "More information requested", info_provided: "You sent more information",
  approved: "Payment verified — wallet credited", rejected: "Request rejected", gateway_success: "Payment confirmed — wallet credited", gateway_failed: "Payment not completed",
};

/** One recharge: receipt for online payments, request tracker for Manual UPI. Own account only. */
export default async function RechargeDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await portalContext();
  const db = await getDb();
  let [rc] = await db.select().from(schema.recharges).where(and(eq(schema.recharges.id, id), eq(schema.recharges.orgId, ctx.org.id)));
  if (!rc) notFound();
  if (rc.status === "payment_pending" && (await rateLimit(`rcrecon:${id}`, 20, 300)).ok) {
    await reconcileRecharge(id);
    [rc] = await db.select().from(schema.recharges).where(eq(schema.recharges.id, id));
  }
  const events = await db.select().from(schema.rechargeEvents).where(eq(schema.rechargeEvents.rechargeId, id)).orderBy(asc(schema.rechargeEvents.createdAt));
  const [ticket] = rc.ticketId ? await db.select({ number: schema.tickets.number, status: schema.tickets.status }).from(schema.tickets).where(and(eq(schema.tickets.id, rc.ticketId), eq(schema.tickets.orgId, ctx.org.id))) : [];
  const st = rechargeStatus(rc.status);
  const manual = rc.method === "manual";
  return (
    <>
      <AutoRefresh active={rc.status === "payment_pending"} everyMs={6000} />
      <div className="page-h">
        <div><Link className="small link-navy" href="/portal/billing/recharges/"><ArrowLeft size={14} aria-hidden /> All Recharges</Link><h1>{manual ? `Recharge request ${rc.requestNumber}` : "Recharge receipt"}</h1></div>
        <span className={`chip ${st.chip}`} style={{ fontSize: 14, padding: "6px 14px" }}>{st.label}</span>
      </div>
      <div className="rc-grid" style={{ maxWidth: 1000 }}>
        <div className="col" style={{ gap: 12 }}>
          {rc.status === "info_required" && <div className="note" role="alert"><b>More information required:</b> {rc.decisionNote}</div>}
          {rc.status === "rejected" && <div className="note t-debit" role="alert"><b>Rejected:</b> {rc.decisionNote}</div>}
          {rc.status === "pending_verification" && <div className="note" role="status">We aim to verify your payment and update your wallet within 10 minutes. You can track progress here using Request ID <b>{rc.requestNumber}</b>.</div>}
          {rc.status === "payment_pending" && <div className="note" role="status">Waiting for the payment gateway to confirm. This page updates automatically.</div>}
          <section className="card" style={{ padding: 16 }}>
            <dl className="kv-list">
              {rc.requestNumber && <><dt>Request ID</dt><dd className="mono">{rc.requestNumber}</dd></>}
              <dt>Method</dt><dd>{METHOD_LABEL[rc.method] ?? rc.method}</dd>
              <dt>Wallet recharge</dt><dd>{formatINR(rc.amountPaise)}</dd>
              {manual && <><dt>Discount ({bpsLabel(rc.discountBps)})</dt><dd>{formatINR(rc.discountPaise)}</dd><dt>Amount to pay</dt><dd>{formatINR(rc.payablePaise ?? rc.amountPaise)}</dd><dt>Amount you reported paying</dt><dd>{rc.paidPaise != null ? formatINR(rc.paidPaise) : "—"}</dd></>}
              {!manual && rc.paidPaise != null && <><dt>Amount paid</dt><dd>{formatINR(rc.paidPaise)}</dd></>}
              <dt>{manual ? "UTR / reference" : "Payment reference"}</dt><dd className="mono">{rc.utr ?? rc.razorpayPaymentId ?? rc.providerPaymentId ?? "—"}</dd>
              {!manual && (rc.razorpayOrderId ?? rc.providerOrderId) && <><dt>Order reference</dt><dd className="mono tiny">{rc.razorpayOrderId ?? rc.providerOrderId}</dd></>}
              {rc.paidAt && <><dt>Paid on</dt><dd>{ist(rc.paidAt)}</dd></>}
              <dt>Created</dt><dd>{ist(rc.createdAt)}</dd>
              {rc.status === "credited" && <><dt>Wallet credited</dt><dd className="t-credit">{formatINR(rc.amountPaise)} · {ist(rc.decidedAt ?? rc.updatedAt)}</dd></>}
              {rc.status === "credited" && <><dt>Current balance</dt><dd>{formatINR(ctx.walletAvailable)}</dd></>}
            </dl>
            <div className="row wrap mt12" style={{ gap: 8 }}>
              {rc.ticketId && ticket && <Link className="btn btn-navy btn-sm" href={`/portal/support/${rc.ticketId}/`}>Open ticket {ticket.number}</Link>}
              {rc.proofKey && <a className="btn btn-outline btn-sm" href={`/api/portal/recharge/${rc.id}/proof/`} target="_blank" rel="noopener noreferrer">View my screenshot</a>}
              <Link className="btn btn-outline btn-sm" href="/portal/billing/passbook/">Passbook</Link>
            </div>
          </section>
          {manual && ["info_required", "pending_verification"].includes(rc.status) && <RechargeInfoForm id={rc.id} />}
        </div>
        <aside className="card" style={{ padding: 16 }} aria-label="Progress">
          <h2 style={{ fontSize: 15, margin: "0 0 10px" }}>Progress</h2>
          <ol className="plain-list">
            {events.filter((e) => CUSTOMER_EVENTS[e.action]).map((e) => (
              <li key={e.id} className="small"><b>{CUSTOMER_EVENTS[e.action]}</b><div className="tiny muted">{ist(e.createdAt)}</div>{["info_requested", "rejected"].includes(e.action) && e.note ? <div className="tiny">{e.note}</div> : null}</li>
            ))}
            {events.length === 0 && <li className="small muted">No updates yet.</li>}
          </ol>
        </aside>
      </div>
    </>
  );
}
