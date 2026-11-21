import { BuyPlan } from "@/components/portal/store/Billing";
import { rupees } from "@/lib/store-themes";
import { billingConfig, listPlans, planHistory, planState } from "@/server/store/billing";
import { requireStorePage } from "@/server/store/portal";
import "@/styles/store.css";

export const metadata = { title: "Store plan — Vishwaship" };
const day = (d: Date) => d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" });

export default async function StorePlanPage() {
  const { ctx, store } = await requireStorePage();
  const [plans, history, cfg] = await Promise.all([listPlans(), planHistory(store.id), billingConfig()]);
  const st = planState(store);
  const runningTill = new Date(Math.max(Date.now(), store.paidUntil?.getTime() ?? 0, store.trialEndsAt?.getTime() ?? 0));
  const startsLabel = runningTill.getTime() > Date.now() + 60_000 ? `It starts on ${day(runningTill)}, after your current ${st.state === "trial" ? "free trial" : "plan"} ends, so you lose no days.` : "It starts today.";
  return (
    <>
      <div className="page-h"><div><p className="small muted" style={{ margin: 0 }}><a href="/portal/store/">Online Store</a></p><h1>Store plan</h1></div></div>
      <div className="card" style={{ padding: 16, marginBottom: 16, maxWidth: 860 }} role="status">
        {st.state === "trial" && <><span className="chip c-draft">Free trial</span> <b>{st.daysLeft} {st.daysLeft === 1 ? "day" : "days"} left</b>{st.until && <span className="small muted"> · ends {day(st.until)}</span>}
          <p className="small muted" style={{ margin: "6px 0 0" }}>Your {cfg.trialDays}-day trial includes everything. After it ends your store stays visible, but new orders pause until you choose a plan. Orders already placed keep shipping.</p></>}
        {st.state === "active" && <><span className="chip c-active">Active</span> <b>Paid till {day(st.until!)}</b><span className="small muted"> · {st.daysLeft} days left</span></>}
        {st.state === "expired" && <><span className="chip c-cancelled">Orders paused</span> <b>Your {store.paidUntil ? "plan" : "free trial"} ended on {day(st.until!)}</b>
          <p className="small" style={{ margin: "6px 0 0" }}>Buyers can still see your store, but they can&apos;t place new orders. Choose a plan below to reopen at once.</p></>}
      </div>
      {plans.length ? <BuyPlan plans={plans.map((p) => ({ id: p.id, name: p.name, interval: p.interval, pricePaise: p.pricePaise }))} walletPaise={ctx.walletAvailable} startsLabel={startsLabel} />
        : <p className="small muted">No plans are on sale right now. Please contact support.</p>}
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
