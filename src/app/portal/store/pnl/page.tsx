import { DeleteExpense, ExpenseForm, PnlSettingsForm } from "@/components/portal/store/PnlTools";
import { EXPENSE_CATEGORIES, type ExpenseCategory, listExpenses } from "@/server/store/expenses";
import { istDate, storePnl } from "@/server/store/pnl";
import { requireStorePage } from "@/server/store/portal";
import "@/styles/store.css";

export const metadata = { title: "Profit & Loss — Vishwaship" };
type SP = Promise<{ range?: string; from?: string; to?: string; tab?: string }>;
const D = /^\d{4}-\d{2}-\d{2}$/;

const rs = (p: number) => `${p < 0 ? "−" : ""}₹${Math.abs(p / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
function ranges(today: string) {
  const [y, m] = today.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  const lastPrev = new Date(Date.UTC(y, m - 1, 0));
  const back = (days: number) => istDate(new Date(new Date(`${today}T12:00:00+05:30`).getTime() - days * 86_400_000));
  return {
    month: { label: "This month", from: `${y}-${pad(m)}-01`, to: today },
    last_month: { label: "Last month", from: `${lastPrev.getUTCFullYear()}-${pad(lastPrev.getUTCMonth() + 1)}-01`, to: lastPrev.toISOString().slice(0, 10) },
    d7: { label: "Last 7 days", from: back(6), to: today },
    d30: { label: "Last 30 days", from: back(29), to: today },
  } as Record<string, { label: string; from: string; to: string }>;
}

export default async function StorePnl({ searchParams }: { searchParams: SP }) {
  const { ctx } = await requireStorePage();
  const sp = await searchParams;
  const today = istDate(new Date());
  const R = ranges(today);
  const custom = D.test(sp.from ?? "") && D.test(sp.to ?? "") && sp.from! <= sp.to! && sp.to! <= today;
  const key = custom && sp.range === "custom" ? "custom" : R[sp.range ?? ""] ? sp.range! : "month";
  const r = key === "custom" ? { from: sp.from!, to: sp.to! } : { from: R[key].from, to: R[key].to };
  const tab = ["summary", "orders", "expenses"].includes(sp.tab ?? "") ? sp.tab! : "summary";
  const [p, expenses] = await Promise.all([storePnl(ctx.org.id, r), listExpenses(ctx.org.id, r.from, r.to)]);
  const s = p.summary, prev = p.previous.summary;
  const q = (over: Record<string, string>) => `?${new URLSearchParams({ range: key, ...(key === "custom" ? { from: r.from, to: r.to } : {}), tab, ...over }).toString()}`;
  const delta = (a: number, b: number) => (b === 0 ? null : Math.round(((a - b) / Math.abs(b)) * 100));
  const lines: Array<{ label: string; v: number; sign: "+" | "−" | "="; strong?: boolean }> = [
    { label: "Net sales (delivered, ex-GST)", v: s.netSales, sign: "+" }, { label: "Shipping & COD fee collected", v: s.shippingCollected, sign: "+" },
    { label: "Product cost", v: s.productCost, sign: "−" }, { label: "Shipping paid (incl. RTO)", v: s.shippingPaid, sign: "−" },
    { label: "Payment fees (estimated)", v: s.paymentFees, sign: "−" }, { label: "Order expenses (packaging …)", v: s.orderExpenses, sign: "−" },
    { label: "Order contribution", v: s.contribution, sign: "=", strong: true },
  ];
  const max = Math.max(1, ...lines.map((l) => Math.abs(l.v)), s.overhead, Math.abs(s.net));
  const cats = (Object.keys(EXPENSE_CATEGORIES) as ExpenseCategory[]).map((k) => ({ key: k, label: EXPENSE_CATEGORIES[k].label }));
  const dn = delta(s.net, prev.net);
  return (
    <>
      <div className="page-h"><div><p className="small muted" style={{ margin: 0 }}><a href="/portal/store/">Online Store</a></p><h1>Profit &amp; Loss</h1>
        <p className="small muted" style={{ margin: "4px 0 0" }}>Sales count when delivered. RTO orders count as a loss on the day they turned RTO. {r.from} to {r.to}.</p></div>
        <div className="row" style={{ gap: 6 }}>
          <a className="btn btn-outline btn-sm" href={`/api/portal/store/pnl?from=${r.from}&to=${r.to}&format=csv`} download>CSV</a>
          <a className="btn btn-outline btn-sm" href={`/api/portal/store/pnl?from=${r.from}&to=${r.to}&format=xlsx`} download>Excel</a>
        </div>
      </div>

      <nav className="so-tabs" aria-label="Period">
        {Object.entries(R).map(([k, v]) => <a key={k} href={`?${new URLSearchParams({ range: k, tab }).toString()}`} className={k === key ? "on" : ""} aria-current={k === key ? "page" : undefined}>{v.label}</a>)}
      </nav>
      <details className="card mb12 so-filters" style={{ padding: "4px 12px" }} open={key === "custom"}>
        <summary>Custom dates</summary>
        <form className="row wrap" style={{ gap: 8, alignItems: "flex-end", paddingBottom: 10 }}>
          <input type="hidden" name="range" value="custom" /><input type="hidden" name="tab" value={tab} />
          <div className="field"><label htmlFor="f">From</label><input id="f" type="date" name="from" className="input" max={today} defaultValue={r.from} /></div>
          <div className="field"><label htmlFor="t">To</label><input id="t" type="date" name="to" className="input" max={today} defaultValue={r.to} /></div>
          <button className="btn btn-outline" style={{ minHeight: 42 }}>Show</button>
        </form>
      </details>

      {s.incomplete > 0 && <div className="err-box small mb12" role="alert"><b>Profit is incomplete:</b> {s.incomplete} order(s) have products without a unit cost. <a className="orange" href="/portal/store/inventory/?view=nocost">Add costs in Inventory</a>.</div>}

      <div className="so-kpis">
        <div className="card so-kpi"><b style={{ color: s.net < 0 ? "#b42318" : undefined }}>{rs(s.net)}</b><span>Net profit{dn !== null ? ` · ${dn > 0 ? "+" : ""}${dn}% vs previous` : ""}</span></div>
        <div className="card so-kpi"><b>{rs(s.revenue)}</b><span>Revenue · {s.delivered} delivered</span></div>
        <div className="card so-kpi"><b>{s.marginPct === null ? "—" : `${s.marginPct}%`}</b><span>Margin</span></div>
        <div className="card so-kpi"><b style={{ color: s.rtoLoss < 0 ? "#b42318" : undefined }}>{rs(s.rtoLoss)}</b><span>RTO / lost · {s.rto} order(s)</span></div>
        <div className="card so-kpi"><b>{s.pending.count}</b><span>Pending · {rs(s.pending.valuePaise)} on the way</span></div>
      </div>

      <nav className="so-tabs" aria-label="Section">
        {[["summary", "Breakdown"], ["orders", `Orders (${p.orders.length})`], ["expenses", `Expenses (${expenses.length})`]].map(([k, l]) => <a key={k} href={q({ tab: k })} className={k === tab ? "on" : ""} aria-current={k === tab ? "page" : undefined}>{l}</a>)}
      </nav>

      {tab === "summary" && (
        <div className="grid2" style={{ alignItems: "start" }}>
          <div className="card" style={{ padding: 14 }}>
            <h3 style={{ fontSize: 14, margin: "0 0 10px" }}>Where the money went</h3>
            <ul className="pl-bars">
              {lines.map((l) => <li key={l.label} className={l.strong ? "strong" : ""}><span>{l.sign} {l.label}</span><b>{rs(l.v)}</b><i style={{ width: `${(Math.abs(l.v) / max) * 100}%` }} className={l.sign === "−" ? "neg" : ""} aria-hidden /></li>)}
              <li><details><summary><span>− Store-level expenses</span></summary>
                <ul className="pl-sub">{p.overhead.length ? p.overhead.map((o) => <li key={o.key}><span>{o.label}</span><b>{rs(o.amount)}</b></li>) : <li className="muted">None in this period</li>}</ul></details>
                <b>{rs(s.overhead)}</b><i style={{ width: `${(s.overhead / max) * 100}%` }} className="neg" aria-hidden /></li>
              <li className="strong"><span>= Net profit</span><b style={{ color: s.net < 0 ? "#b42318" : undefined }}>{rs(s.net)}</b><i style={{ width: `${(Math.abs(s.net) / max) * 100}%` }} className={s.net < 0 ? "neg" : ""} aria-hidden /></li>
            </ul>
            <p className="tiny muted" style={{ marginBottom: 0 }}>Previous period ({p.previous.range.from} to {p.previous.range.to}): net {rs(prev.net)}, revenue {rs(prev.revenue)}.</p>
          </div>
          <div style={{ display: "grid", gap: 12 }}>
            <div className="card" style={{ padding: 14 }}>
              <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>GST</h3>
              {p.gst.registered ? (
                <dl className="kv-list">
                  <dt>Output GST (sales + shipping collected)</dt><dd>{rs(p.gst.output)}</dd>
                  <dt>Input GST you can claim</dt><dd>{rs(p.gst.inputRecoverable)}</dd>
                  <dt>GST not claimable (in costs)</dt><dd>{rs(p.gst.nonRecoverable)}</dd>
                  <dt><b>Net GST (estimate)</b></dt><dd><b>{rs(p.gst.payable)}</b></dd>
                </dl>
              ) : <p className="small muted" style={{ margin: 0 }}>You are set as not GST registered: GST you pay is part of your costs and no output GST is shown.</p>}
              <p className="tiny muted" style={{ margin: "8px 0 0" }}>For your accountant. File returns from your own books.</p>
            </div>
            <details className="card" style={{ padding: 14 }}><summary className="small" style={{ cursor: "pointer", fontWeight: 600 }}>P&amp;L settings</summary><div style={{ marginTop: 10 }}><PnlSettingsForm initial={p.settings} /></div></details>
          </div>
        </div>
      )}

      {tab === "orders" && (p.orders.length === 0 ? <div className="card"><p className="muted" style={{ padding: 24, textAlign: "center", margin: 0 }}>No delivered or RTO orders in this period.</p></div> : (
        <>
          <div className="card p0 only-desktop" style={{ overflowX: "auto" }}>
            <table className="os-dns">
              <thead><tr><th>Date</th><th>Order</th><th>Outcome</th><th style={{ textAlign: "right" }}>Sales</th><th style={{ textAlign: "right" }}>Shipping in</th><th style={{ textAlign: "right" }}>Product</th><th style={{ textAlign: "right" }}>Shipping paid</th><th style={{ textAlign: "right" }}>Fees + exp.</th><th style={{ textAlign: "right" }}>Profit</th><th>Notes</th></tr></thead>
              <tbody>{p.orders.map((o) => (
                <tr key={o.id}>
                  <td className="small">{o.date}</td><td><a className="orange" href={`/portal/store/orders/${o.id}/`}>{o.number}</a></td>
                  <td className="small">{o.outcome === "delivered" ? "Delivered" : o.outcome === "lost" ? "Lost" : "RTO"} · {o.method === "cod" ? "COD" : "Prepaid"}</td>
                  <td style={{ textAlign: "right" }}>{rs(o.netSales)}</td><td style={{ textAlign: "right" }}>{rs(o.shippingCollected)}</td><td style={{ textAlign: "right" }}>{rs(o.productCost)}</td>
                  <td style={{ textAlign: "right" }}>{rs(o.shippingPaid)}</td><td style={{ textAlign: "right" }}>{rs(o.paymentFees + o.orderExpenses)}</td>
                  <td style={{ textAlign: "right", fontWeight: 700, color: o.contribution < 0 ? "#b42318" : undefined }}>{rs(o.contribution)}</td>
                  <td className="tiny muted">{o.flags.join("; ")}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <ul className="so-cards only-mobile">
            {p.orders.map((o) => (
              <li key={o.id} className="card so-card">
                <details>
                  <summary className="pl-ord"><span><b>{o.number}</b><span className="tiny muted"> · {o.date} · {o.outcome === "delivered" ? "Delivered" : o.outcome === "lost" ? "Lost" : "RTO"}</span></span>
                    <b style={{ color: o.contribution < 0 ? "#b42318" : undefined }}>{rs(o.contribution)}</b></summary>
                  <dl className="kv-list" style={{ marginTop: 8 }}>
                    <dt>Net sales</dt><dd>{rs(o.netSales)}</dd><dt>Shipping collected</dt><dd>{rs(o.shippingCollected)}</dd><dt>Product cost</dt><dd>− {rs(o.productCost)}</dd>
                    <dt>Shipping paid</dt><dd>− {rs(o.shippingPaid)}</dd><dt>Payment fees</dt><dd>− {rs(o.paymentFees)}</dd><dt>Order expenses</dt><dd>− {rs(o.orderExpenses)}</dd>
                  </dl>
                  {o.flags.length > 0 && <p className="tiny red" style={{ margin: "6px 0 0" }}>{o.flags.join("; ")}</p>}
                  <a className="small orange" href={`/portal/store/orders/${o.id}/`}>Open order</a>
                </details>
              </li>
            ))}
          </ul>
        </>
      ))}

      {tab === "expenses" && (
        <div className="grid2" style={{ alignItems: "start" }}>
          <ExpenseForm categories={cats} today={today} />
          <div className="card" style={{ padding: 14 }}>
            <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>Expenses in this period · {rs(expenses.reduce((t, x) => t + x.e.amountPaise, 0))}</h3>
            {expenses.length === 0 ? <p className="small muted" style={{ margin: 0 }}>Nothing added for these dates.</p> : (
              <ul className="dp-files">
                {expenses.map(({ e, order }) => (
                  <li key={e.id}>
                    <span className="small" style={{ minWidth: 0, overflowWrap: "anywhere" }}><b>{rs(e.amountPaise)}</b> · {EXPENSE_CATEGORIES[e.category as ExpenseCategory]?.label ?? e.category}
                      <span className="tiny muted"> · {e.spentOn}{order ? ` · ${order}` : ""}{e.gstPaise ? ` · GST ${rs(e.gstPaise)}${e.gstRecoverable ? " (claimable)" : ""}` : ""}{e.recurring ? " · monthly" : e.recurringOf ? " · repeat" : ""}{e.note ? ` · ${e.note}` : ""}</span></span>
                    <span className="row" style={{ gap: 6, flexShrink: 0 }}>
                      {e.receiptKey && <a className="btn btn-outline btn-sm" href={`/api/portal/store/expenses/${e.id}/receipt`} target="_blank" rel="noopener">Bill</a>}
                      <DeleteExpense id={e.id} label={`${rs(e.amountPaise)} on ${e.spentOn}`} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
}
