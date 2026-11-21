import { rupeesText } from "@/lib/franchise";
import { accrueCommissions, commissionByPeriod, commissionLines, pctText, periodLabel, periodOf, payoutsList } from "@/server/franchise/commission";
import { requireFranchise } from "@/server/franchise/session";
import { day } from "../parts";

const PAYOUT: Record<string, string> = { draft: "Being prepared", approved: "Approved, payment due", paid: "Paid", cancelled: "Cancelled" };
const LINE: Record<string, string> = { earned: "Unpaid", in_payout: "In statement", paid: "Paid", void: "Removed" };

export default async function FranchiseEarnings() {
  const { franchise: f } = await requireFranchise();
  await accrueCommissions(f.id).catch(() => 0);
  const [months, payouts, lines] = await Promise.all([commissionByPeriod(f.id), payoutsList({ franchiseId: f.id }), commissionLines(f.id, { limit: 100 })]);
  const cur = periodOf(new Date());
  const thisMonth = months.find((m) => m.period === cur);
  const unpaid = months.reduce((s, m) => s + m.unpaidPaise, 0);
  const paid = payouts.filter((p) => p.p.status === "paid").reduce((s, p) => s + p.p.netPaise, 0);
  return (
    <>
      <div className="page-h"><div><h1>Commission</h1><p className="small muted" style={{ margin: "4px 0 0" }}>Earned on delivered shipments of your customers. Paid monthly after Vishwaship&apos;s review, by bank transfer{f.payoutAccountLast4 ? ` to account ending ${f.payoutAccountLast4}` : ""}.</p></div></div>
      <div className="grid3 mb12" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))" }}>
        <div className="card" style={{ padding: 14 }}><div className="tiny muted">Earned this month</div><div style={{ fontSize: 22, fontWeight: 700 }}>{rupeesText(thisMonth?.earnedPaise ?? 0)}</div><div className="tiny muted">{thisMonth?.shipments ?? 0} delivered shipments</div></div>
        <div className="card" style={{ padding: 14 }}><div className="tiny muted">Not paid yet</div><div style={{ fontSize: 22, fontWeight: 700 }}>{rupeesText(unpaid)}</div><div className="tiny muted">before TDS</div></div>
        <div className="card" style={{ padding: 14 }}><div className="tiny muted">Paid to you</div><div style={{ fontSize: 22, fontWeight: 700 }}>{rupeesText(paid)}</div><div className="tiny muted">after TDS</div></div>
      </div>
      {f.status === "suspended" && <p className="err-box small mb12">Commission is on hold while your franchise is suspended.</p>}

      <div className="card p0 mb12"><div className="card-h"><b>Statements</b></div>
        {payouts.length === 0 ? <p className="small muted" style={{ padding: 16, margin: 0 }}>No statement yet. Statements are made after each month ends.</p> : (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Month</th><th>Statement</th><th>Shipments</th><th>Commission</th><th>TDS</th><th>Adjustment</th><th>Net</th><th>Status</th></tr></thead>
            <tbody>{payouts.map(({ p }) => (
              <tr key={p.id}>
                <td className="small">{periodLabel(p.period)}</td><td className="small mono">{p.statementNumber}</td><td className="small">{p.shipments}</td>
                <td className="small">{rupeesText(p.grossPaise)}</td><td className="small">−{rupeesText(p.tdsPaise)} <span className="tiny muted">({pctText(p.tdsBps)})</span></td>
                <td className="small">{p.adjustmentPaise ? <>{p.adjustmentPaise > 0 ? "+" : "−"}{rupeesText(Math.abs(p.adjustmentPaise))}<div className="tiny muted">{p.adjustmentNote}</div></> : "—"}</td>
                <td className="small"><b>{rupeesText(p.netPaise)}</b></td>
                <td className="small">{PAYOUT[p.status]}{p.status === "paid" && <div className="tiny muted">{day(p.paidOn)} · UTR {p.utr}</div>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>

      <div className="grid2" style={{ alignItems: "start" }}>
        <div className="card p0"><div className="card-h"><b>By month</b></div>
          {months.length === 0 ? <p className="small muted" style={{ padding: 16, margin: 0 }}>No commission yet.</p> : (
            <table className="tbl"><thead><tr><th>Month</th><th>Shipments</th><th>Earned</th><th>Unpaid</th></tr></thead>
              <tbody>{months.map((m) => <tr key={m.period}><td className="small">{periodLabel(m.period)}</td><td className="small">{m.shipments}</td><td className="small">{rupeesText(m.earnedPaise)}</td><td className="small">{rupeesText(m.unpaidPaise)}</td></tr>)}</tbody></table>
          )}
        </div>
        <div className="card p0"><div className="card-h"><b>Latest commission</b></div>
          {lines.length === 0 ? <p className="small muted" style={{ padding: 16, margin: 0 }}>Nothing yet.</p> : (
            <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Delivered</th><th>Customer</th><th>Order</th><th>Rate</th><th>Commission</th><th>Status</th></tr></thead>
              <tbody>{lines.map(({ c, business, orderNumber }) => (
                <tr key={c.id}><td className="small">{day(c.deliveredAt)}</td><td className="small">{business}</td><td className="small mono">{orderNumber}</td>
                  <td className="small">{pctText(c.customerBps)}</td><td className="small">{rupeesText(c.amountPaise)}</td><td className="small">{LINE[c.status]}{c.voidReason && <div className="tiny muted">{c.voidReason}</div>}</td></tr>
              ))}</tbody></table></div>
          )}
        </div>
      </div>
    </>
  );
}
