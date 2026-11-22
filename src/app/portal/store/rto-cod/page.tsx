import { CodQuestion, CompareCod } from "@/components/portal/store/RtoCodTools";
import { RTO_SOURCES, RTO_STATE_LABEL, rtoReport } from "@/server/rto/charges";
import { COD_STATE_LABEL, codSettlements, codShipments, codTotals } from "@/server/store/cod";
import { requireStorePage } from "@/server/store/portal";
import "@/styles/store.css";

export const metadata = { title: "RTO & COD — Vishwaship" };
type SP = Promise<{ tab?: string; from?: string; to?: string; courier?: string; awb?: string; state?: string; all?: string }>;
const rs = (p: number | null) => (p === null ? "—" : `₹${(p / 100).toLocaleString("en-IN", { minimumFractionDigits: p % 100 ? 2 : 0, maximumFractionDigits: 2 })}`);
const day = (d: Date | null) => (d ? d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short" }) : "—");

export default async function RtoCod({ searchParams }: { searchParams: SP }) {
  const { ctx } = await requireStorePage();
  const sp = await searchParams;
  const tab = ["rto", "cod", "settlements", "check"].includes(sp.tab ?? "") ? sp.tab! : "cod";
  const storeOnly = sp.all !== "1";
  const qs = (over: Record<string, string | undefined>) => { const u = new URLSearchParams(); for (const [k, v] of Object.entries({ ...sp, tab, ...over })) if (v) u.set(k, v); return `?${u.toString()}`; };
  const exp = (kind: string, format: string) => `/api/portal/store/rto-cod?${new URLSearchParams(Object.fromEntries(Object.entries({ kind, format, from: sp.from, to: sp.to, courier: sp.courier, awb: sp.awb, state: sp.state, all: sp.all }).filter(([, v]) => v)) as Record<string, string>).toString()}`;
  const filters = (states: Record<string, string>, courier = false) => (
    <form className="card mb12 row wrap" style={{ padding: 12, gap: 8, alignItems: "flex-end" }} role="search">
      <input type="hidden" name="tab" value={tab} />{sp.all && <input type="hidden" name="all" value={sp.all} />}
      <div className="field" style={{ flex: 1, minWidth: 150 }}><label htmlFor="awb">AWB / order</label><input id="awb" name="awb" type="search" className="input" defaultValue={sp.awb ?? ""} enterKeyHint="search" /></div>
      <div className="field"><label htmlFor="st">Status</label><select id="st" name="state" className="input select" defaultValue={sp.state ?? ""}><option value="">All</option>{Object.entries(states).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
      <div className="field"><label htmlFor="f">Booked from</label><input id="f" type="date" name="from" className="input" defaultValue={sp.from ?? ""} /></div>
      <div className="field"><label htmlFor="t">to</label><input id="t" type="date" name="to" className="input" defaultValue={sp.to ?? ""} /></div>
      {courier && <div className="field"><label htmlFor="c">Courier</label><input id="c" name="courier" className="input" defaultValue={sp.courier ?? ""} style={{ width: 130 }} /></div>}
      <button className="btn btn-outline" style={{ minHeight: 42 }}>Apply</button>
    </form>
  );

  let body: React.ReactNode = null;
  if (tab === "cod") {
    const rows = await codShipments(ctx.org.id, { from: sp.from, to: sp.to, state: sp.state, q: sp.awb, storeOnly });
    const t = codTotals(rows);
    body = (
      <>
        <div className="so-kpis">
          <div className="card so-kpi"><b>{rs(t.collected)}</b><span>Collected by couriers</span></div>
          <div className="card so-kpi"><b>{rs(t.remitted)}</b><span>Paid out to you</span></div>
          <div className={`card so-kpi${t.outstanding ? " hot" : ""}`}><b>{rs(t.outstanding)}</b><span>Outstanding (delivered, not paid out)</span></div>
          <div className="card so-kpi"><b>{t.byState.awaiting}</b><span>Awaiting delivery · {rs(rows.filter((r) => r.state === "awaiting").reduce((s, r) => s + r.duePaise, 0))}</span></div>
          <div className={`card so-kpi${t.byState.disputed ? " hot" : ""}`}><b>{t.byState.disputed}</b><span>Open questions</span></div>
        </div>
        {filters(COD_STATE_LABEL)}
        <p className="small muted">{rows.length} COD shipment(s) · <a className="orange" href={exp("cod", "csv")} download>CSV</a> · <a className="orange" href={exp("cod", "xlsx")} download>Excel</a></p>
        {rows.length === 0 ? <div className="card"><p className="muted" style={{ padding: 24, textAlign: "center", margin: 0 }}>No COD shipments here.</p></div> : (
          <ul className="so-cards dp-grid">
            {rows.slice(0, 300).map((r) => (
              <li key={r.shipmentId} className="card so-card">
                <div className="so-card-h"><span className="so-card-link"><span className="so-num">{r.orderNumber}</span><span className="tiny muted mono">{r.courier} · {r.awb ?? "no AWB"}</span></span>
                  <span className={`chip ${["remitted"].includes(r.state) ? "c-active" : ["disputed", "partial", "not_collectable"].includes(r.state) ? "c-cancelled" : "c-draft"}`}>{COD_STATE_LABEL[r.state]}</span></div>
                <dl className="inv-nums">
                  <div><dt>Due</dt><dd>{rs(r.duePaise)}</dd></div><div><dt>Collected</dt><dd>{rs(r.collectedPaise)}</dd></div>
                  <div><dt>Paid out</dt><dd>{rs(r.remittedPaise)}</dd></div><div><dt>Outstanding</dt><dd className={r.outstandingPaise ? "red" : ""}>{rs(r.outstandingPaise)}</dd></div>
                </dl>
                <p className="tiny muted" style={{ margin: 0 }}>Delivered {day(r.deliveredAt)} · COD fee {rs(r.codFeePaise)} (in the shipping charge){r.settledAt ? ` · paid ${day(r.settledAt)}${r.utr ? `, UTR ${r.utr}` : ""}` : r.expectedPayoutAt ? ` · payout expected ${day(r.expectedPayoutAt)}` : ""}</p>
                {r.dispute ? <p className="tiny red" style={{ margin: "6px 0 0" }}>Your question: {r.dispute.note}</p>
                  : r.lastDispute?.status === "resolved" ? <p className="tiny" style={{ margin: "6px 0 0" }}>Vishwaship answered: {r.lastDispute.resolution}</p> : null}
                {!r.dispute && r.state !== "awaiting" && <div style={{ marginTop: 8 }}><CodQuestion shipmentId={r.shipmentId} awb={r.awb} /></div>}
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }
  if (tab === "rto") {
    const rows = await rtoReport(ctx.org.id, { from: sp.from, to: sp.to, courier: sp.courier, awb: sp.awb, state: sp.state, storeOnly });
    const final = rows.filter((r) => !r.estimated).reduce((s, r) => s + (r.finalChargePaise ?? 0), 0), est = rows.filter((r) => r.estimated).reduce((s, r) => s + r.rtoChargePaise, 0);
    body = (
      <>
        <div className="so-kpis">
          <div className="card so-kpi"><b>{rows.length}</b><span>RTO shipments</span></div>
          <div className="card so-kpi"><b>{rs(final)}</b><span>Final RTO charges</span></div>
          <div className="card so-kpi"><b>{rs(est)}</b><span>Estimated (charge not confirmed yet)</span></div>
          <div className="card so-kpi"><b>{rs(rows.reduce((s, r) => s + r.forwardTotalPaise, 0))}</b><span>Forward shipping on these</span></div>
        </div>
        {filters(RTO_STATE_LABEL, true)}
        <p className="small muted">Estimates are labelled until the courier&apos;s RTO charge is confirmed. · <a className="orange" href={exp("rto", "csv")} download>CSV</a> · <a className="orange" href={exp("rto", "xlsx")} download>Excel</a></p>
        {rows.length === 0 ? <div className="card"><p className="muted" style={{ padding: 24, textAlign: "center", margin: 0 }}>No RTO shipments here.</p></div> : (
          <ul className="so-cards dp-grid">
            {rows.slice(0, 300).map((r) => (
              <li key={r.shipmentId} className="card so-card">
                <div className="so-card-h"><span className="so-card-link"><span className="so-num">{r.orderNumber}</span><span className="tiny muted mono">{r.courier} · {r.awb}</span></span>
                  <span className={`chip ${r.state === "reconciled" ? "c-active" : r.estimated ? "c-draft" : "c-cancelled"}`}>{RTO_STATE_LABEL[r.state] ?? r.state}</span></div>
                <dl className="inv-nums">
                  <div><dt>Forward</dt><dd>{rs(r.forwardTotalPaise)}</dd></div>
                  <div><dt>RTO {r.estimated ? "(est.)" : ""}</dt><dd>{rs(r.rtoChargePaise)}</dd></div>
                  <div><dt>Credits</dt><dd>{rs(r.creditsPaise)}</dd></div>
                  <div><dt>Final</dt><dd>{r.finalChargePaise === null ? "pending" : rs(r.finalChargePaise)}</dd></div>
                </dl>
                <p className="tiny muted" style={{ margin: 0 }}>Picked {day(r.pickupDate)} · RTO started {day(r.rtoInitiatedAt)}{r.rtoDeliveredAt ? ` · back ${day(r.rtoDeliveredAt)}` : ""}{r.reason ? ` · ${r.reason}` : ""}
                  {r.estimated ? ` · ${r.estimateBasis ?? "estimate"}` : ` · ${r.source ? RTO_SOURCES[r.source as keyof typeof RTO_SOURCES] ?? r.source : ""}${r.reference ? ` ${r.reference}` : ""}`}</p>
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }
  if (tab === "settlements") {
    const b = await codSettlements(ctx.org.id, storeOnly);
    body = (
      <>
        <p className="small muted">Each payout covers many AWBs. · <a className="orange" href={exp("settlements", "csv")} download>CSV</a> · <a className="orange" href={exp("settlements", "xlsx")} download>Excel</a></p>
        {b.length === 0 ? <div className="card"><p className="muted" style={{ padding: 24, textAlign: "center", margin: 0 }}>No COD payouts yet.</p></div> : (
          <ul className="so-cards">
            {b.map((s) => (
              <li key={s.id} className="card so-card">
                <details>
                  <summary className="pl-ord"><span><b>{rs(s.netPaise)}</b><span className="tiny muted"> · {s.status === "paid" ? `paid ${day(s.paidAt)}` : `expected ${day(s.expectedPayoutAt)}`} · {s.awbs.length} AWB</span></span>
                    <span className={`chip ${s.status === "paid" ? "c-active" : "c-draft"}`}>{s.status === "paid" ? "Paid" : "Scheduled"}</span></summary>
                  <p className="tiny muted" style={{ margin: "6px 0" }}>Gross {rs(s.grossPaise)}{s.deductionsPaise ? ` − deductions ${rs(s.deductionsPaise)}${s.deductionNote ? ` (${s.deductionNote})` : ""}` : ""}{s.utr ? ` · UTR ${s.utr}` : ""}</p>
                  <ul className="pl-sub">{s.awbs.map((a) => <li key={a.awb ?? a.order}><span className="mono">{a.awb}</span><span>{a.order}</span><b>{rs(a.codPaise)}</b></li>)}</ul>
                </details>
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }
  if (tab === "check") body = <CompareCod />;

  return (
    <>
      <div className="page-h"><div><p className="small muted" style={{ margin: 0 }}><a href="/portal/store/">Online Store</a></p><h1>RTO &amp; COD</h1>
        <p className="small muted" style={{ margin: "4px 0 0" }}>COD money per AWB from delivery to payout, and RTO charges order by order. {storeOnly ? "Showing store orders." : "Showing all shipments of your account."} <a className="orange" href={qs({ all: storeOnly ? "1" : undefined })}>{storeOnly ? "Show all shipments" : "Store orders only"}</a></p></div></div>
      <nav className="so-tabs" aria-label="Section">
        {[["cod", "COD per AWB"], ["settlements", "COD payouts"], ["rto", "RTO charges"], ["check", "Check a file"]].map(([k, l]) => <a key={k} href={`?tab=${k}${sp.all ? "&all=1" : ""}`} className={k === tab ? "on" : ""} aria-current={k === tab ? "page" : undefined}>{l}</a>)}
      </nav>
      {body}
    </>
  );
}
