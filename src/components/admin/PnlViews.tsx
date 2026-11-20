import Link from "next/link";
import { formatINR } from "@/lib/money";
import type { PnlRow } from "@/server/finance/pnl";

const tone = (v: number) => (v > 0 ? "pl-up" : v < 0 ? "pl-down" : "");
const pct = (v: number | null) => (v == null ? "—" : `${v.toFixed(1)}%`);

/** Big figures: revenue, cost, profit (or loss), margin — plus the money flow. */
export function PnlSummary({ r, scope }: { r: PnlRow; scope: string }) {
  const loss = r.profit < 0;
  return (
    <>
      <div className="pl-tiles" aria-label={`Profit and loss — ${scope}`}>
        <div className="pl-tile"><span>Revenue (excl. GST)</span><b>{formatINR(r.revenue)}</b><small>shipping {formatINR(r.shippingRevenue)} · weight {formatINR(r.weightRevenue)} · credits {formatINR(r.creditsRevenue)}{r.adjustmentsNet ? ` · adjustments ${formatINR(r.adjustmentsNet)}` : ""}</small></div>
        <div className="pl-tile"><span>Courier cost (excl. GST)</span><b>{formatINR(r.courierCost)}</b><small>{r.shipments.toLocaleString("en-IN")} shipments{r.carrierExtra > 0 ? ` · ${formatINR(r.carrierExtra)} above quote` : ""}</small></div>
        <div className={`pl-tile big ${loss ? "loss" : "gain"}`}><span>{loss ? "Loss" : "Profit"}</span><b>{formatINR(Math.abs(r.profit))}</b><small>margin {pct(r.marginPct)}{r.lossShipments ? ` · ${r.lossShipments} shipment${r.lossShipments === 1 ? "" : "s"} below cost` : ""}</small></div>
        <div className="pl-tile"><span>GST collected (payable)</span><b>{formatINR(r.gstCollected)}</b><small>not income — goes to GST</small></div>
      </div>
      <div className="pl-flow" aria-label="Money flow">
        <div><span>Recharged</span><b>{formatINR(r.recharged)}</b></div>
        <div><span>Consumed from wallet</span><b>{formatINR(r.consumed)}</b></div>
        <div><span>Wallet balance now</span><b>{formatINR(r.walletBalance)}</b></div>
        <div><span>Weight discrepancy (net)</span><b className={tone(r.weightNet)}>{formatINR(r.weightNet)}</b></div>
        <div><span>Open weight disputes</span><b>{r.openDisputes}</b></div>
        {r.fodFreight > 0 && <div><span>FOD freight (collected by courier)</span><b>{formatINR(r.fodFreight)}</b></div>}
      </div>
    </>
  );
}

/** Customer-wise table, most profitable first; losses in red. */
export function PnlTable({ rows, total, rangeQs }: { rows: PnlRow[]; total: PnlRow; rangeQs: string }) {
  return (
    <div className="card p0 tbl-wrap"><table className="tbl pl-tbl">
      <thead><tr><th>Customer</th><th className="num">Shipments</th><th className="num">Revenue</th><th className="num">Courier cost</th><th className="num">Profit / loss</th><th className="num">Margin</th><th className="num">Weight (net)</th><th className="num">Recharged</th><th className="num">Wallet</th><th className="num">Loss shipments</th></tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.orgId}>
          <td><Link className="b link-navy" href={`/admin/customers/${r.orgId}/?tab=pnl&${rangeQs}`}>{r.name}</Link></td>
          <td className="num">{r.shipments.toLocaleString("en-IN")}</td>
          <td className="num">{formatINR(r.revenue)}</td>
          <td className="num">{formatINR(r.courierCost)}</td>
          <td className={`num b ${tone(r.profit)}`}>{r.profit < 0 ? "−" : ""}{formatINR(Math.abs(r.profit))}</td>
          <td className={`num ${tone(r.profit)}`}>{pct(r.marginPct)}</td>
          <td className="num">{formatINR(r.weightNet)}</td>
          <td className="num">{formatINR(r.recharged)}</td>
          <td className="num">{formatINR(r.walletBalance)}</td>
          <td className={`num ${r.lossShipments ? "pl-down" : "muted"}`}>{r.lossShipments}</td>
        </tr>
      ))}</tbody>
      <tfoot><tr><th>Total ({rows.length})</th><th className="num">{total.shipments.toLocaleString("en-IN")}</th><th className="num">{formatINR(total.revenue)}</th><th className="num">{formatINR(total.courierCost)}</th><th className={`num ${tone(total.profit)}`}>{total.profit < 0 ? "−" : ""}{formatINR(Math.abs(total.profit))}</th><th className="num">{pct(total.marginPct)}</th><th className="num">{formatINR(total.weightNet)}</th><th className="num">{formatINR(total.recharged)}</th><th className="num">{formatINR(total.walletBalance)}</th><th className="num">{total.lossShipments}</th></tr></tfoot>
    </table></div>
  );
}
