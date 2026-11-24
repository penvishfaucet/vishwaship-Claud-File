import { BuyPlan } from "@/components/portal/store/Billing";
import { rupees } from "@/lib/store-themes";
import { billingConfig, listPlans, planGross, planHistory, planState } from "@/server/store/billing";
import { getSetting } from "@/server/quotes/service";
import { creditPrice } from "@/server/notifications/credits";
import { requireStorePage } from "@/server/store/portal";
import "@/styles/store.css";

export const metadata = { title: "Store plan & deposit — Vishwaship" };
const day = (d: Date) => d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });

export default async function StorePlanPage() {
  const { ctx, store } = await requireStorePage();
  const [plans, history, cfg, gst, costs, price] = await Promise.all([listPlans(), planHistory(store.id), billingConfig(), getSetting<number>("gst_bps", 1800), getSetting<Record<string, number>>("notification_credit_cost", {}), creditPrice()]);
  const perUse = (credits: number) => `${credits} credit${credits === 1 ? "" : "s"} (₹${((credits * price.paisePerCredit) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })})`;
  const depositHeld = (store.paidUntil?.getUTCFullYear() ?? 0) >= 2099;
  const st = planState(store);
  const runningTill = new Date(Math.max(Date.now(), store.paidUntil?.getTime() ?? 0, store.trialEndsAt?.getTime() ?? 0));
  const startsLabel = runningTill.getTime() > Date.now() + 60_000 ? `It starts on ${day(runningTill)}, after your current ${st.state === "trial" ? "free trial" : "plan"} ends, so you lose no days.` : "It starts today.";
  return (
    <>
      <div className="page-h"><div><p className="small muted" style={{ margin: 0 }}><a href="/portal/store/">Online Store</a></p><h1>Store plan</h1></div></div>
      <div className="card" style={{ padding: 16, marginBottom: 16, maxWidth: 860 }} role="status">
        {st.state === "trial" && <><span className="chip c-draft">Free trial</span> <b>{st.daysLeft} {st.daysLeft === 1 ? "day" : "days"} left</b>{st.until && <span className="small muted"> · ends {day(st.until)}</span>}
          <p className="small muted" style={{ margin: "6px 0 0" }}>Your {cfg.trialDays}-day trial includes everything. After it ends your store stays visible, but new orders pause until you pay the refundable security deposit. Orders already placed keep shipping.</p></>}
        {st.state === "active" && (st.until!.getUTCFullYear() >= 2099 ? <><span className="chip c-active">Active</span> <b>Open — security deposit held</b></> : <><span className="chip c-active">Active</span> <b>Paid till {day(st.until!)}</b><span className="small muted"> · {st.daysLeft} days left</span></>)}
        {st.state === "expired" && <><span className="chip c-cancelled">Store unavailable to buyers</span> <b>Your {store.paidUntil ? "plan" : "free trial"} ended on {day(st.until!)}</b>
          <p className="small" style={{ margin: "6px 0 0" }}>Buyers now see a &ldquo;store unavailable&rdquo; page and cannot order. Your dashboard, orders, labels, refunds, RTO, COD, inventory and reports keep working. Pay the refundable security deposit below: the same store, products and design reopen at once.</p></>}
      </div>
      <h2 className="h3" style={{ margin: "0 0 8px" }}>Choose how you run your store</h2>
      {plans.length > 0 && !depositHeld && (
        <div className="card" style={{ padding: 16, maxWidth: 860, marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>Self-serve plan — first month free, then ₹2,499 + GST a month</h3>
          <p className="small muted" style={{ margin: "6px 0 10px" }}>You run the store yourself and connect your own domain, payment gateway, one-click checkout, OTP and WhatsApp in <a className="orange" href="/portal/store/connect/">Connect apps</a> (you pay those companies directly). Anything you use from Vishwaship instead is charged per use (see below). Shipping is charged per shipment at your courier rate.</p>
          <BuyPlan plans={plans.map((p) => ({ id: p.id, name: p.name, interval: p.interval, pricePaise: p.pricePaise, grossPaise: planGross(p.pricePaise, gst.value) }))} walletPaise={ctx.walletAvailable} startsLabel={startsLabel} />
        </div>
      )}
      {(
          <div className="card" style={{ padding: 16, maxWidth: 860, borderColor: "var(--orange)" }}>
            <h3 style={{ margin: 0 }}>Vishwaship Growth Package</h3>
            <p style={{ margin: "6px 0" }}><b>₹2,499 + GST refundable security deposit</b> · no monthly fee · <b>1.5% + GST on delivered orders only</b></p>
            <p className="small muted" style={{ margin: "0 0 10px" }}>Your store stays open while the deposit is held. No fee on RTO or cancelled orders. COD: the fee is deducted from the COD amount and the rest is paid D+5 after delivery. Prepaid: buyers pay into your own Razorpay. Minimum 3 months; minimum ad budget ₹1,000 a day in your own Meta / Google account.</p>
            <a className="btn btn-orange" href="/portal/store/managed-ads/">Accept terms &amp; pay deposit</a>
          </div>
        )}
      <div className="card" style={{ padding: 16, maxWidth: 860, marginTop: 12 }}>
        <h3 style={{ margin: 0 }}>Using Vishwaship services instead of your own</h3>
        <p className="small muted" style={{ margin: "6px 0 8px" }}>Taken from your notification credits only when used. Connect your own accounts in <a className="orange" href="/portal/store/connect/">Connect apps</a> and these become ₹0 from Vishwaship.</p>
        <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Service</th><th>Vishwaship&apos;s</th><th>Your own</th></tr></thead><tbody>
          <tr><td>Buyer login by mobile OTP</td><td>{perUse(costs.value.store_otp ?? 4)} per login</td><td>Your Firebase bill</td></tr>
          <tr><td>WhatsApp message to a buyer</td><td>{perUse(costs.value.whatsapp ?? 1)} per message</td><td>Your WATI / AiSensy bill</td></tr>
          <tr><td>COD confirmation on WhatsApp</td><td>{perUse(costs.value.cod_confirmation ?? 1)} per order</td><td>Your WATI / AiSensy bill</td></tr>
          <tr><td>Emails to buyers</td><td>Free</td><td>—</td></tr>
          <tr><td>Online payments</td><td>Not offered — buyers pay into your own gateway</td><td>Your gateway&apos;s fee</td></tr>
        </tbody></table></div>
      </div>
      <div className="card p0" style={{ marginTop: 20, maxWidth: 860 }}>
        <div className="card-h"><b>Plan payments</b></div>
        {history.length === 0 ? <p className="small muted" style={{ padding: 16, margin: 0 }}>No payments yet.</p> : (
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Date</th><th>Plan</th><th>Period</th><th>Amount</th><th>Receipt</th></tr></thead>
            <tbody>{history.map((h) => <tr key={h.id}><td className="small">{day(h.createdAt)}</td><td className="small">{h.planName}</td><td className="small">{day(h.periodStart)} – {day(h.periodEnd)}</td><td className="small">{rupees(h.amountPaise)}</td>
              <td className="small"><a className="orange" href={`/portal/store/receipts/${h.id}/`}>{h.receiptNumber}</a></td></tr>)}</tbody></table></div>
        )}
      </div>
    </>
  );
}
