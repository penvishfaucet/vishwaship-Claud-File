import Link from "next/link";
import { EarlyCodActions } from "@/components/portal/EarlyCodActions";
import { formatINR } from "@/lib/money";
import { t } from "@/server/content";
import { earlyCodState } from "@/server/early-cod";
import { requireFeature } from "@/server/features";
import { portalContext } from "@/server/portal/context";

const d = (x: Date) => x.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short" });

export default async function EarlyCodPage() {
  const ctx = await portalContext();
  await requireFeature(ctx.org.id, "early_cod");
  const st = await earlyCodState(ctx.org.id);
  const feePct = (st.sub?.feeBps ?? st.terms.feeBps) / 100;
  const total = st.qualifying.reduce((a, q) => ({ cod: a.cod + q.cod, fee: a.fee + q.fee, net: a.net + q.net }), { cod: 0, fee: 0, net: 0 });
  return (
    <>
      <div className="page-h">
        <div><h1>Early COD Subscription</h1><p className="small muted" style={{ margin: "4px 0 0" }}>Get your delivered COD money faster. This is a payout service — it is separate from WhatsApp COD Confirmation.</p></div>
        <div className="actions"><span className={`chip ${st.sub ? "c-active" : "c-draft"}`}>{st.sub ? "Subscribed" : "Not subscribed"}</span></div>
      </div>
      <div className="split" style={{ gap: 16, alignItems: "start" }}>
        <section className="card" style={{ padding: 18 }}>
          <h2 className="b" style={{ fontSize: 15, marginTop: 0 }}>Plan & charges</h2>
          <dl className="kv-list">
            <dt>Payout schedule</dt><dd>D+{st.sub?.cycleDays ?? st.terms.cycleDays} after delivery <span className="tiny muted">(standard: D+{st.terms.standardCycleDays})</span></dd>
            <dt>Fee</dt><dd>{feePct}% of the COD amount, deducted from each early payout (+ GST)</dd>
            <dt>Eligibility</dt><dd>{st.eligible || st.sub ? <span className="chip c-active">Eligible</span> : <span className="chip c-pending">Not yet eligible</span>}</dd>
            {st.sub && <><dt>Active since</dt><dd>{st.sub.startedAt.toLocaleDateString("en-IN")}</dd></>}
          </dl>
          {!st.sub && st.reasons.length > 0 && <ul className="small t-debit" style={{ paddingLeft: 18 }}>{st.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
          {st.termsChanged && <p className="small note">Vishwaship updated the Early COD terms. Your subscription keeps the fee and schedule you accepted.</p>}
          <div className="mt12"><EarlyCodActions active={!!st.sub} eligible={st.eligible} termsVersion={st.terms.version} /></div>
          {!st.sub && st.reasons.some((r) => r.includes("KYC")) && <p className="small mt8"><Link className="link" href="/portal/kyc/">Complete KYC →</Link></p>}
        </section>
        <section className="card" style={{ padding: 18 }}>
          <h2 className="b" style={{ fontSize: 15, marginTop: 0 }}>Terms</h2>
          <p className="small" style={{ whiteSpace: "pre-line" }}>{await t("portal.early_cod.terms")}</p>
        </section>
      </div>
      <section className="card p0 mt16">
        <h2 className="b small card-h" style={{ margin: 0 }}>Qualifying shipments (delivered COD awaiting payout)</h2>
        {st.qualifying.length === 0 ? <p className="small muted" style={{ padding: 16 }}>No delivered COD shipments are waiting for payout.</p> : (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Order</th><th>AWB</th><th>Delivered</th><th style={{ textAlign: "right" }}>COD</th><th style={{ textAlign: "right" }}>{st.sub ? "Early COD fee" : `Fee if subscribed (${feePct}%)`}</th><th style={{ textAlign: "right" }}>Net</th><th>Expected payout</th></tr></thead>
            <tbody>{st.qualifying.map((q) => <tr key={q.shipmentId}><td className="small"><Link className="link-navy" href={`/portal/orders/${q.orderId}/`}>{q.orderNumber}</Link></td><td className="mono tiny">{q.awb}</td><td className="small">{d(q.deliveredAt)}</td><td style={{ textAlign: "right" }} className="small">{formatINR(q.cod)}</td><td style={{ textAlign: "right" }} className="small">{formatINR(q.fee)}</td><td style={{ textAlign: "right" }} className="small b">{formatINR(st.sub ? q.net : q.cod)}</td><td className="small">{d(q.payoutAt)}</td></tr>)}</tbody>
            <tfoot><tr><td colSpan={3} className="b">Total</td><td style={{ textAlign: "right" }} className="b">{formatINR(total.cod)}</td><td style={{ textAlign: "right" }} className="b">{formatINR(total.fee)}</td><td style={{ textAlign: "right" }} className="b">{formatINR(st.sub ? total.net : total.cod)}</td><td /></tr></tfoot>
          </table></div>
        )}
        <p className="tiny muted" style={{ padding: "8px 16px", margin: 0 }}>Actual payouts and references appear in Billing → COD Remittance once Vishwaship finance releases them.</p>
      </section>
    </>
  );
}
