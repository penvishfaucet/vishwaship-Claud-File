import Link from "next/link";
import { formatINR } from "@/lib/money";
import type { PassbookItem } from "@/server/passbook";

const when = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });
/** "+₹1,000.00" / "−₹245.00"; a recharge that did not credit shows the plain amount (no sign). */
const signed = (i: PassbookItem) => `${i.direction === "credit" ? "+" : i.direction === "debit" ? "−" : ""}${formatINR(i.amountPaise)}`;
const dirLabel = (i: PassbookItem) => (i.direction === "credit" ? "Credit" : i.direction === "debit" ? "Debit" : "Not credited");

/**
 * Wallet passbook. Desktop: a table. Phones: one card per transaction — type, signed amount and Credit / Debit on the
 * first line (never hidden or scrolled), then date, status and description; references in an expandable section.
 * `links` decide where Order / recharge links go (Customer Portal or Admin).
 */
export function PassbookView({ items, balance, links }: { items: PassbookItem[]; balance?: { availablePaise: number; postedPaise: number; reservedPaise: number }; links: { order: (id: string, orderNumber: string) => string; recharge: (id: string) => string } }) {
  return (
    <div className="pb">
      {balance && (
        <div className="pb-bal" aria-label="Wallet balance">
          <span className="pb-bal-t">Current wallet balance</span>
          <b className="pb-bal-v">{formatINR(balance.availablePaise)}</b>
          <span className="pb-bal-s">Posted {formatINR(balance.postedPaise)}{balance.reservedPaise ? ` · on hold for bookings ${formatINR(balance.reservedPaise)}` : ""}</span>
        </div>
      )}
      {!items.length ? <div className="card empty"><p className="muted">No wallet transactions for these filters.</p></div> : (
        <>
          <div className="card p0 tbl-wrap pb-table">
            <table className="tbl">
              <thead><tr><th>Date &amp; time</th><th>Transaction</th><th>Status</th><th>Reference</th><th style={{ textAlign: "right" }}>Amount</th><th style={{ textAlign: "right" }}>Balance after</th></tr></thead>
              <tbody>{items.map((i) => (
                <tr key={i.id}>
                  <td className="small nowrap">{when(i.at)}</td>
                  <td className="small"><b>{i.title}</b><div className="tiny muted">{i.description}</div></td>
                  <td><span className={`chip ${i.statusChip}`}>{i.status}</span></td>
                  <td className="tiny"><Refs i={i} links={links} /></td>
                  <td className={`small b nowrap pb-amt ${i.direction}`} style={{ textAlign: "right" }}>{signed(i)}<div className="tiny">{dirLabel(i)}</div></td>
                  <td className="small nowrap" style={{ textAlign: "right" }}>{i.balanceAfterPaise != null ? formatINR(i.balanceAfterPaise) : "—"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <ul className="pb-cards" aria-label="Wallet transactions">
            {items.map((i) => (
              <li key={i.id} className={`pb-card ${i.direction}`}>
                <details>
                  <summary>
                    <span className="pb-l1"><b className="pb-title">{i.title}</b><b className={`pb-amt ${i.direction}`}>{signed(i)}</b></span>
                    <span className="pb-l2"><span className={`pb-dir ${i.direction}`}>{dirLabel(i)}</span><span className={`chip ${i.statusChip}`}>{i.status}</span><time>{when(i.at)}</time></span>
                    <span className="pb-desc">{i.description}</span>
                  </summary>
                  <dl className="pb-more">
                    {i.balanceAfterPaise != null && <><dt>Balance after</dt><dd>{formatINR(i.balanceAfterPaise)}</dd></>}
                    {i.reference && <><dt>Payment reference</dt><dd className="mono">{i.reference}</dd></>}
                    {i.orderNumber && <><dt>Order ID</dt><dd>{i.orderId ? <Link className="link-navy" href={links.order(i.orderId, i.orderNumber ?? "")}>{i.orderNumber}</Link> : i.orderNumber}</dd></>}
                    {i.awb && <><dt>AWB</dt><dd className="mono">{i.awb}</dd></>}
                    {i.rechargeId && <><dt>Recharge</dt><dd><Link className="link-navy" href={links.recharge(i.rechargeId)}>View recharge</Link></dd></>}
                    {!i.reference && !i.orderNumber && !i.awb && !i.rechargeId && i.balanceAfterPaise == null && <><dt>Details</dt><dd>No further details recorded</dd></>}
                  </dl>
                </details>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function Refs({ i, links }: { i: PassbookItem; links: { order: (id: string, orderNumber: string) => string; recharge: (id: string) => string } }) {
  const parts = [
    i.orderNumber && (i.orderId ? <Link key="o" className="link-navy" href={links.order(i.orderId, i.orderNumber ?? "")}>{i.orderNumber}</Link> : <span key="o">{i.orderNumber}</span>),
    i.awb && <span key="a" className="mono">AWB {i.awb}</span>,
    i.reference && <span key="r" className="mono">{i.reference}</span>,
    i.rechargeId && <Link key="rc" className="link-navy" href={links.recharge(i.rechargeId)}>Recharge</Link>,
  ].filter(Boolean);
  return parts.length ? <span className="pb-refs">{parts}</span> : <span className="muted">—</span>;
}
