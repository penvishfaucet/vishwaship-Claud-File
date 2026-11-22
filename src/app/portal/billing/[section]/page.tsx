import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { Download, Printer, Wallet } from "lucide-react";
import { BuyCredits } from "@/components/portal/BuyCredits";
import { RechargeV2 } from "@/components/portal/RechargeV2";
import { getPaymentSettings, usableGateways } from "@/server/payments/settings";
import { METHOD_LABEL, rechargeStatus } from "@/lib/recharge";
import { formatINR } from "@/lib/money";
import { codOverview, creditHistory, documentsOf, ledgerStatement, range, rechargesOf, shippingCharges } from "@/server/billing";
import { t } from "@/server/content";
import { getDb, schema } from "@/server/db/client";
import { PassbookView } from "@/components/billing/PassbookView";
import { PASSBOOK_TYPES, type PassbookType, passbookHistory } from "@/server/passbook";
import { portalContext } from "@/server/portal/context";
import { creditPrice } from "@/server/notifications/credits";
import { codSettings } from "@/server/whatsapp/service";
import { getSetting } from "@/server/quotes/service";

const SECTIONS = {
  passbook: { title: "Passbook", desc: "Every wallet credit and debit with its reference and running balance.", export: "passbook" },
  "cod-remittance": { title: "COD Remittance", desc: "Cash collected from your buyers, remittance batches, deductions and payout references.", export: "cod" },
  "shipping-charges": { title: "Shipping Charges", desc: "Charge breakdown per AWB / LR: freight, COD fee, surcharges, GST and weight adjustments.", export: "charges" },
  recharges: { title: "All Recharges", desc: "Wallet recharges, payment references, payment status and wallet credit status.", export: "recharges" },
  invoices: { title: "Invoices", desc: "Vishwaship tax invoices for your shipping charges.", export: "invoices" },
  "credit-notes": { title: "Credit Notes", desc: "Amounts credited back to you — waived weight charges, refunds and corrections.", export: "credit_notes" },
  "debit-notes": { title: "Debit Notes", desc: "Additional charges raised after booking, such as weight discrepancies.", export: "debit_notes" },
  ledgers: { title: "Ledgers", desc: "Account statement for any period: opening balance, entries and closing balance.", export: "ledger" },
  "notification-credits": { title: "Notification Credit History", desc: "Notification credit purchases, usage per message, refunds and balance.", export: "credits" },
} as const;
type Section = keyof typeof SECTIONS;

const d = (x: Date | null | undefined) => (x ? x.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }) : "—");
const dt = (x: Date) => x.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const amt = (p: number | null | undefined) => (p == null ? "—" : formatINR(p));
const R = { textAlign: "right" as const };
type SP = { from?: string; to?: string; recharge?: string; q?: string; type?: string; amount?: string; next?: string };
/** Continue links after a recharge: only our own pages. */
const NEXT: Record<string, string> = { deposit: "/portal/store/managed-ads/" };

export default async function BillingSection({ params, searchParams }: { params: Promise<{ section: string }>; searchParams: Promise<SP> }) {
  const { section } = await params;
  if (!(section in SECTIONS)) notFound();
  const key = section as Section;
  const sp = await searchParams;
  const ctx = await portalContext();
  const db = await getDb();
  const showRecharge = ["passbook", "recharges"].includes(key);
  const pay = showRecharge ? await getPaymentSettings() : null;
  const gws = showRecharge ? await usableGateways() : [];
  const meta = SECTIONS[key];
  const dated = ["passbook", "shipping-charges", "ledgers"].includes(key);
  const { from, to } = range(sp, key === "ledgers" ? 30 : 90);
  const qs = new URLSearchParams(Object.entries({ from: sp.from, to: sp.to }).filter(([, v]) => v) as [string, string][]).toString();
  const pbType = (PASSBOOK_TYPES.find((t) => t.key === sp.type)?.key ?? "all") as PassbookType | "all";
  return (
    <>
      <div className="page-h">
        <div><p className="small muted" style={{ margin: 0 }}>{await t("nav.billing")}</p><h1>{await t(`nav.billing.${({ passbook: "passbook", "cod-remittance": "cod", "shipping-charges": "charges", recharges: "recharges", invoices: "invoices", "credit-notes": "credit_notes", "debit-notes": "debit_notes", ledgers: "ledgers", "notification-credits": "credits" } as const)[key]}`)}</h1><p className="small muted" style={{ margin: "4px 0 0" }}>{meta.desc}</p></div>
        <div className="actions">
          <a className="btn btn-outline" href={`/api/portal/export/${meta.export}?${qs}`}><Download size={16} /> CSV</a>
          <a className="btn btn-outline" href={`/api/portal/export/${meta.export}?${qs}${qs ? "&" : ""}format=xlsx`}><Download size={16} /> Excel</a>
        </div>
      </div>
      {showRecharge && pay && (
        <div className="mb16">
          <div className="stat bl-orange mb12">
            <div className="t"><Wallet size={14} /> Available balance</div>
            <div className="v">{formatINR(ctx.walletAvailable)}</div>
            <div className="s">Posted {formatINR(ctx.walletPosted)}{ctx.walletReserved ? ` · on hold ${formatINR(ctx.walletReserved)}` : ""}</div>
          </div>
          <RechargeV2
            balancePaise={ctx.walletAvailable}
            gateways={gws.map((g) => g.gateway)}
            demo={!gws.length && process.env.NODE_ENV !== "production"}
            online={{ minPaise: pay.onlineMinPaise, maxPaise: pay.onlineMaxPaise }}
            manual={pay.manual.enabled && pay.manual.upiId && pay.manual.qrKey ? { upiId: pay.manual.upiId, payeeName: pay.manual.payeeName, hasQr: !!pay.manual.qrKey, instructions: pay.manual.instructions, discountBps: pay.manual.discountBps, minPaise: pay.manual.minPaise, maxPaise: pay.manual.maxPaise, reviewMessage: pay.manual.reviewMessage } : null}
            autoFocus={!!sp.recharge || !!sp.amount}
            initialAmount={/^d{1,7}$/.test(sp.amount ?? "") ? sp.amount : undefined}
            next={sp.next && NEXT[sp.next] ? { href: NEXT[sp.next], label: "Continue to pay the security deposit" } : undefined}
          />
        </div>
      )}
      {dated && (
        <form className="card mb12 pb-filter">
          <div className="field"><label htmlFor="bf">From</label><input id="bf" type="date" name="from" className="input" defaultValue={sp.from ?? from.toISOString().slice(0, 10)} /></div>
          <div className="field"><label htmlFor="bt">To</label><input id="bt" type="date" name="to" className="input" defaultValue={sp.to ?? to.toISOString().slice(0, 10)} /></div>
          {key === "passbook" && <div className="field"><label htmlFor="btype">Transaction type</label><select id="btype" name="type" className="select" defaultValue={pbType}>{PASSBOOK_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select></div>}
          <button className="btn btn-navy">Apply</button>
          <Link className="btn btn-outline" href={`/portal/billing/${key}/`}>Reset</Link>
        </form>
      )}
      {key === "passbook" && <PassbookView items={await passbookHistory(ctx.org.id, { from, to, type: pbType })} links={{ order: (id) => `/portal/orders/${id}/`, recharge: (id) => `/portal/billing/recharges/${id}/` }} />}
      {key === "ledgers" && <Ledger orgId={ctx.org.id} from={from} to={to} />}
      {key === "shipping-charges" && <Charges orgId={ctx.org.id} from={from} to={to} />}
      {key === "cod-remittance" && <Cod orgId={ctx.org.id} />}
      {key === "recharges" && <Recharges orgId={ctx.org.id} />}
      {key === "invoices" && <Docs orgId={ctx.org.id} kind="invoice" />}
      {key === "credit-notes" && <Docs orgId={ctx.org.id} kind="credit_note" />}
      {key === "debit-notes" && <Docs orgId={ctx.org.id} kind="debit_note" />}
      {key === "notification-credits" && <Credits orgId={ctx.org.id} balance={ctx.credits} wallet={ctx.walletAvailable} />}
    </>
  );
}

const Empty = ({ text }: { text: string }) => <div className="card empty"><p className="muted">{text}</p></div>;

async function Ledger({ orgId, from, to }: { orgId: string; from: Date; to: Date }) {
  const st = await ledgerStatement(orgId, from, to);
  const posted = st.entries.filter((e) => e.amountPaise !== 0);
  return (
    <>
      <div className="stats mb12">
        <div className="stat bl-blue"><div className="t">Opening balance</div><div className="v">{formatINR(st.opening)}</div><div className="s">{d(from)}</div></div>
        <div className="stat bl-green"><div className="t">Credits</div><div className="v">{formatINR(st.credits)}</div></div>
        <div className="stat bl-red"><div className="t">Debits</div><div className="v">{formatINR(st.debits)}</div></div>
        <div className="stat bl-orange"><div className="t">Closing balance</div><div className="v">{formatINR(st.closing)}</div><div className="s">{d(to)}</div></div>
      </div>
      {posted.length === 0 ? <Empty text="No posted entries in this period. Holds for pending bookings are not ledger entries." /> : (
        <div className="card p0 tbl-wrap"><table className="tbl">
          <thead><tr><th>Date</th><th>Particulars</th><th>Reference</th><th style={R}>Debit</th><th style={R}>Credit</th><th style={R}>Balance</th></tr></thead>
          <tbody>
            <tr><td className="small">{d(from)}</td><td className="small b">Opening balance</td><td /><td /><td /><td style={R} className="small b">{formatINR(st.opening)}</td></tr>
            {posted.map((e) => <tr key={e.id}><td className="small">{dt(e.createdAt)}</td><td className="small">{e.memo ?? e.kind.replace(/_/g, " ")}</td><td className="tiny mono muted">{e.refId ?? "—"}</td><td style={R} className="small">{e.amountPaise < 0 ? formatINR(-e.amountPaise) : ""}</td><td style={R} className="small">{e.amountPaise > 0 ? formatINR(e.amountPaise) : ""}</td><td style={R} className="small">{formatINR(e.balanceAfterPaise)}</td></tr>)}
            <tr><td className="small">{d(to)}</td><td className="small b">Closing balance</td><td /><td style={R} className="small b">{formatINR(st.debits)}</td><td style={R} className="small b">{formatINR(st.credits)}</td><td style={R} className="small b">{formatINR(st.closing)}</td></tr>
          </tbody>
        </table></div>
      )}
    </>
  );
}

async function Charges({ orgId, from, to }: { orgId: string; from: Date; to: Date }) {
  const rows = await shippingCharges(orgId, from, to);
  if (!rows.length) return <Empty text="No shipments booked in this period." />;
  const sum = (k: "freight" | "codFee" | "surcharges" | "gst" | "weightAdjustment" | "total") => rows.reduce((t, r) => t + (r[k] ?? 0), 0);
  return (
    <div className="card p0 tbl-wrap">
      <table className="tbl">
        <thead><tr><th>Date</th><th>Order</th><th>AWB / LR</th><th>Courier</th><th>Chargeable</th><th style={R}>Freight</th><th style={R}>COD fee</th><th style={R}>Surcharges</th><th style={R}>GST</th><th style={R}>Weight adj.</th><th style={R}>Total</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="small">{d(r.createdAt)}</td><td><Link className="link-navy small" href={`/portal/orders/${r.orderId}/`}>{r.orderNumber}</Link></td>
              <td className="mono tiny">{r.awb ?? r.lr ?? "—"}</td><td className="small">{r.carrier}</td><td className="small">{(r.chargeableGrams / 1000).toFixed(2)} kg</td>
              <td style={R} className="small" title={r.lines.map((l) => `${l.label}: ${formatINR(l.sell)}`).join("\n")}>{amt(r.freight)}</td>
              <td style={R} className="small">{amt(r.codFee)}</td><td style={R} className="small">{amt(r.surcharges)}</td><td style={R} className="small">{amt(r.gst)}</td>
              <td style={R} className={r.weightAdjustment ? "small t-debit" : "small muted"}>{r.weightAdjustment ? formatINR(r.weightAdjustment) : "—"}</td>
              <td style={R} className="small b">{formatINR(r.total)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td colSpan={5} className="b">Total ({rows.length})</td><td style={R} className="b">{formatINR(sum("freight"))}</td><td style={R} className="b">{formatINR(sum("codFee"))}</td><td style={R} className="b">{formatINR(sum("surcharges"))}</td><td style={R} className="b">{formatINR(sum("gst"))}</td><td style={R} className="b">{formatINR(sum("weightAdjustment"))}</td><td style={R} className="b">{formatINR(sum("total"))}</td></tr></tfoot>
      </table>
      <p className="tiny muted" style={{ padding: "8px 12px", margin: 0 }}>Amounts are what you were charged (selling price). Hover a freight value to see every component.</p>
    </div>
  );
}

async function Cod({ orgId }: { orgId: string }) {
  const c = await codOverview(orgId);
  return (
    <>
      <div className="stats mb12">
        <div className="stat bl-blue"><div className="t">COD collected (delivered)</div><div className="v">{formatINR(c.totals.collected)}</div></div>
        <div className="stat bl-green"><div className="t">Remitted (paid out)</div><div className="v">{formatINR(c.totals.paid)}</div></div>
        <div className="stat bl-yellow"><div className="t">Scheduled payouts</div><div className="v">{formatINR(c.totals.scheduled)}</div></div>
        <div className="stat bl-orange"><div className="t">Awaiting next cycle</div><div className="v">{formatINR(c.totals.unbatched)}</div><div className="s">Deductions so far {formatINR(c.totals.deductions)}</div></div>
      </div>
      <section className="card p0 mb12">
        <h2 className="b small card-h" style={{ margin: 0 }}>Remittance payouts</h2>
        {c.batches.length === 0 ? <p className="small muted" style={{ padding: 16 }}>No remittance batches yet. Delivered COD is grouped into a payout on each remittance cycle.</p> : (
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Cycle</th><th>Expected payout</th><th style={R}>Gross COD</th><th style={R}>Deductions</th><th style={R}>Net payout</th><th>Status</th><th>Payout reference</th></tr></thead>
            <tbody>{c.batches.map((b) => <tr key={b.id}><td className="small">{d(b.cycleDate)}{b.earlyCod && <span className="chip c-pending" style={{ marginLeft: 6 }}>Early COD</span>}</td><td className="small">{d(b.expectedPayoutAt)}</td><td style={R} className="small">{formatINR(b.grossPaise)}</td><td style={R} className="small" title={b.deductionNote ?? ""}>{formatINR(b.deductionsPaise)}</td><td style={R} className="small b">{formatINR(b.netPaise)}</td><td><span className={`chip ${b.status === "paid" ? "c-active" : b.status === "cancelled" ? "c-draft" : "c-pending"}`}>{b.status}</span>{b.paidAt && <div className="tiny muted">{d(b.paidAt)}</div>}</td><td className="small mono">{b.reference ?? "—"}</td></tr>)}</tbody></table></div>
        )}
      </section>
      {c.rows.length === 0 ? <Empty text="No COD shipments yet." /> : (
        <div className="card p0 tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Order</th><th>AWB</th><th>Shipment status</th><th style={R}>COD amount</th><th>Reconciliation</th><th>Payout ref.</th></tr></thead>
            <tbody>{c.rows.map((r) => <tr key={r.orderId}><td><Link className="link-navy small" href={`/portal/orders/${r.orderId}/`}>{r.orderNumber}</Link></td><td className="mono tiny">{r.awb}</td><td className="small">{r.status.replace(/_/g, " ")}</td><td style={R}>{formatINR(r.cod)}</td><td><span className={`chip ${r.state === "Remitted" ? "c-active" : r.state === "Scheduled" ? "c-pending" : r.state === "Not collectable" ? "c-draft" : "c-pending"}`}>{r.state}</span></td><td className="small mono">{r.remittance?.reference ?? (r.remittance ? `due ${d(r.remittance.expectedPayoutAt)}` : "—")}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      <p className="tiny muted mt8">Buyer COD amounts are tracked separately from your shipping wallet. A shipment is included in exactly one payout; status changes only on carrier settlement or an approved finance entry.</p>
    </>
  );
}

async function Recharges({ orgId }: { orgId: string }) {
  const rows = await rechargesOf(orgId);
  if (!rows.length) return <Empty text="No recharges yet. Use Recharge above to add money to your wallet." />;
  return (
    <div className="card p0 tbl-wrap"><table className="tbl">
      <thead><tr><th>Date</th><th>Request / reference</th><th>Method</th><th style={R}>Wallet credit</th><th style={R}>Paid</th><th style={R}>Discount</th><th>Status</th><th /></tr></thead>
      <tbody>{rows.map((r) => {
        const st = rechargeStatus(r.status);
        return (
          <tr key={r.id}>
            <td className="small">{dt(r.createdAt)}</td>
            <td className="small"><span className="b mono">{r.requestNumber ?? "—"}</span><div className="tiny mono muted">{r.utr ?? r.razorpayPaymentId ?? r.providerPaymentId ?? r.razorpayOrderId ?? r.id}</div></td>
            <td className="small">{METHOD_LABEL[r.method] ?? r.method}</td>
            <td style={R} className="b">{formatINR(r.amountPaise)}</td>
            <td style={R} className="small">{r.paidPaise != null ? formatINR(r.paidPaise) : r.payablePaise != null ? formatINR(r.payablePaise) : "—"}</td>
            <td style={R} className="small">{r.discountPaise ? formatINR(r.discountPaise) : "—"}</td>
            <td><span className={`chip ${st.chip}`}>{st.label}</span></td>
            <td className="row" style={{ gap: 6 }}><Link className="btn btn-sm btn-outline" href={`/portal/billing/recharges/${r.id}/`}>View</Link>{r.ticketId && <Link className="btn btn-sm btn-outline" href={`/portal/support/${r.ticketId}/`}>Ticket</Link>}</td>
          </tr>
        );
      })}</tbody>
    </table></div>
  );
}

async function Docs({ orgId, kind }: { orgId: string; kind: "invoice" | "credit_note" | "debit_note" }) {
  const rows = await documentsOf(orgId, kind);
  const label = kind === "invoice" ? "invoices" : kind === "credit_note" ? "credit notes" : "debit notes";
  if (!rows.length) return <Empty text={kind === "invoice" ? "No invoices yet. Vishwaship issues a tax invoice for each billing period." : `No ${label} yet.`} />;
  return (
    <div className="card p0 tbl-wrap"><table className="tbl">
      <thead><tr><th>Date</th><th>Number</th>{kind === "invoice" ? <th>Period</th> : <th>Reason</th>}{kind !== "invoice" && <th>Related</th>}<th style={R}>Taxable</th><th style={R}>GST</th><th style={R}>Total</th><th /></tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.id}>
          <td className="small">{d(r.docDate)}</td><td className="small mono b">{r.number}</td>
          {kind === "invoice" ? <td className="small">{d(r.periodFrom)} – {d(r.periodTo)}</td> : <td className="small">{r.reason ?? "—"}</td>}
          {kind !== "invoice" && <td className="tiny mono muted">{r.refType ? `${r.refType} ${r.refId ?? ""}` : "—"}</td>}
          <td style={R} className="small">{formatINR(r.taxablePaise)}</td><td style={R} className="small">{formatINR(r.gstPaise)}</td><td style={R} className="small b">{formatINR(r.totalPaise)}</td>
          <td><a className="btn btn-sm btn-outline" href={`/portal/billing/document/${r.id}/`} target="_blank" rel="noreferrer"><Printer size={14} /> View / PDF</a></td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}

async function Credits({ orgId, balance, wallet }: { orgId: string; balance: number; wallet: number }) {
  const db = await getDb();
  const packs = await db.select().from(schema.creditPacks).where(eq(schema.creditPacks.active, true)).orderBy(asc(schema.creditPacks.sort));
  const [gst] = await db.select().from(schema.pricingSettings).where(eq(schema.pricingSettings.key, "gst_bps"));
  const hist = await creditHistory(orgId);
  const [price, cod, costs] = await Promise.all([creditPrice(), codSettings(), getSetting("notification_credit_cost", { whatsapp: 1 } as Record<string, number>)]);
  return (
    <>
      <BuyCredits balance={balance} walletPaise={wallet} gstBps={Number(gst?.value ?? 1800)} packs={packs.map((p) => ({ id: p.id, credits: p.credits, unitPricePaise: p.unitPricePaise }))}
        price={price} perMessage={{ cod: cod.credits, whatsapp: Number(costs.value.whatsapp ?? 1) }} />
      <div className="card p0 tbl-wrap mt12">
        <table className="tbl">
          <thead><tr><th>Date</th><th>Type</th><th>Event</th><th>Reference</th><th style={R}>Credits</th><th style={R}>Balance</th><th style={R}>Paid</th></tr></thead>
          <tbody>
            {hist.length === 0 && <tr><td colSpan={7} className="muted small center">No credit activity yet.</td></tr>}
            {hist.map((h) => <tr key={h.id}><td className="small">{dt(h.createdAt)}</td><td className="small">{h.type}</td><td className="small">{h.event || "—"}</td><td className="tiny mono muted">{h.orderId ? <Link className="link-navy" href={`/portal/orders/${h.orderId}/`}>{h.refId}</Link> : h.refId ?? "—"}</td><td style={R} className={h.credits > 0 ? "t-credit b" : "t-debit b"}>{h.credits > 0 ? "+" : ""}{h.credits}</td><td style={R} className="small">{h.balanceAfter}</td><td style={R} className="small">{h.pricePaise ? formatINR(h.pricePaise + (h.gstPaise ?? 0)) : "—"}</td></tr>)}
          </tbody>
        </table>
      </div>
      <p className="small mt8"><Link className="link" href="/portal/notifications/">Notification settings →</Link></p>
    </>
  );
}

export async function generateMetadata({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  return { title: `${SECTIONS[section as Section]?.title ?? "Billing"} — Vishwaship` };
}
