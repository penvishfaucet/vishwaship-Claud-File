import Link from "next/link";
import { and, asc, desc, eq } from "drizzle-orm";
import { Download, Wallet } from "lucide-react";
import { BuyCredits } from "@/components/portal/BuyCredits";
import { RechargePanel } from "@/components/portal/RechargePanel";
import { formatINR } from "@/lib/money";
import { getDb, schema } from "@/server/db/client";
import { portalContext } from "@/server/portal/context";

const TABS = [
  ["passbook", "Passbook"], ["cod", "COD Remittance"], ["charges", "Shipping Charges"], ["invoices", "Invoices"],
  ["notes", "Credit/Debit Notes"], ["credits", "Notification Credits"], ["disputes", "Weight Disputes"],
] as const;

const d = (x: Date) => x.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ tab?: string; recharge?: string }> }) {
  const sp = await searchParams;
  const tab = TABS.find(([k]) => k === sp.tab)?.[0] ?? "passbook";
  const ctx = await portalContext();
  const db = await getDb();
  const [razorpay] = await db.select().from(schema.providerAccounts).where(and(eq(schema.providerAccounts.adapter, "razorpay"), eq(schema.providerAccounts.status, "enabled")));

  return (
    <>
      <div className="page-h">
        <h1>Wallet &amp; Billing</h1>
        <div className="actions"><a className="btn btn-outline" href={`/api/portal/export/${tab}`}><Download size={16} /> Export</a></div>
      </div>
      <div className="grid2 mb16" style={{ gap: 12, alignItems: "start" }}>
        <div className="stat bl-orange">
          <div className="t"><Wallet size={14} /> Available balance</div>
          <div className="v">{formatINR(ctx.walletAvailable)}</div>
          <div className="s">Posted {formatINR(ctx.walletPosted)}{ctx.walletReserved ? ` · on hold ${formatINR(ctx.walletReserved)}` : ""}</div>
        </div>
        <RechargePanel open={!!sp.recharge} razorpayConfigured={!!razorpay} />
      </div>
      <nav className="tabs" aria-label="Billing sections">
        {TABS.map(([k, l]) => <Link key={k} href={`/portal/billing/?tab=${k}`} className={tab === k ? "on" : ""}>{l}</Link>)}
      </nav>
      {tab === "passbook" && <Passbook walletId={ctx.walletId} />}
      {tab === "charges" && <Charges orgId={ctx.org.id} />}
      {tab === "credits" && <Credits orgId={ctx.org.id} balance={ctx.credits} wallet={ctx.walletAvailable} />}
      {tab === "disputes" && <Disputes orgId={ctx.org.id} />}
      {tab === "cod" && <Cod orgId={ctx.org.id} />}
      {(tab === "invoices" || tab === "notes") && (
        <div className="card empty"><p className="muted">{tab === "invoices" ? "Monthly GST invoices appear here on the 1st of each month." : "Credit and debit notes appear here when charges are revised or waived."}</p></div>
      )}
    </>
  );
}

async function Passbook({ walletId }: { walletId: string | null }) {
  if (!walletId) return null;
  const db = await getDb();
  const rows = await db.select().from(schema.ledgerEntries).where(eq(schema.ledgerEntries.walletId, walletId)).orderBy(desc(schema.ledgerEntries.createdAt)).limit(100);
  if (!rows.length) return <div className="card empty"><p className="muted">No transactions yet.</p></div>;
  return (
    <div className="card p0 tbl-wrap">
      <table className="tbl">
        <thead><tr><th>Date</th><th>Description</th><th>Reference</th><th style={{ textAlign: "right" }}>Opening</th><th style={{ textAlign: "right" }}>Amount</th><th style={{ textAlign: "right" }}>Closing</th><th style={{ textAlign: "right" }}>On hold</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="small">{d(r.createdAt)}</td>
              <td className="small">{r.memo ?? r.kind.replace(/_/g, " ")}</td>
              <td className="tiny mono muted">{r.refId ?? "—"}</td>
              <td style={{ textAlign: "right" }} className="small">{formatINR(r.balanceAfterPaise - r.amountPaise)}</td>
              <td style={{ textAlign: "right" }} className={r.amountPaise > 0 ? "small b t-credit" : r.amountPaise < 0 ? "small b t-debit" : "small muted"}>{r.amountPaise === 0 ? (r.holdDeltaPaise > 0 ? "hold" : "released") : (r.amountPaise > 0 ? "+" : "") + formatINR(r.amountPaise)}</td>
              <td style={{ textAlign: "right" }} className="small">{formatINR(r.balanceAfterPaise)}</td>
              <td style={{ textAlign: "right" }} className="small muted">{formatINR(r.reservedAfterPaise)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function Charges({ orgId }: { orgId: string }) {
  const db = await getDb();
  const rows = await db.select({ s: schema.shipments, o: schema.orders }).from(schema.shipments).innerJoin(schema.orders, eq(schema.orders.id, schema.shipments.orderId))
    .where(eq(schema.shipments.orgId, orgId)).orderBy(desc(schema.shipments.createdAt)).limit(100);
  const total = rows.reduce((s, r) => s + r.s.sellPaise, 0);
  return (
    <div className="card p0 tbl-wrap">
      <table className="tbl">
        <thead><tr><th>Date</th><th>Order</th><th>AWB</th><th>Courier</th><th>Chargeable</th><th style={{ textAlign: "right" }}>Charged (incl. GST)</th></tr></thead>
        <tbody>
          {rows.map(({ s, o }) => <tr key={s.id}><td className="small">{d(s.createdAt)}</td><td><Link className="link-navy" href={`/portal/orders/${o.id}/`}>{o.orderNumber}</Link></td><td className="mono tiny">{s.awb}</td><td className="small">{s.carrierName}</td><td className="small">{(s.chargeableWeightGrams / 1000).toFixed(2)} kg</td><td style={{ textAlign: "right" }}>{formatINR(s.sellPaise)}</td></tr>)}
        </tbody>
        <tfoot><tr><td colSpan={5} className="b">Total</td><td className="b" style={{ textAlign: "right" }}>{formatINR(total)}</td></tr></tfoot>
      </table>
    </div>
  );
}

async function Credits({ orgId, balance, wallet }: { orgId: string; balance: number; wallet: number }) {
  const db = await getDb();
  const packs = await db.select().from(schema.creditPacks).where(eq(schema.creditPacks.active, true)).orderBy(asc(schema.creditPacks.sort));
  const [gst] = await db.select().from(schema.pricingSettings).where(eq(schema.pricingSettings.key, "gst_bps"));
  const hist = await db.select().from(schema.creditEntries).where(eq(schema.creditEntries.orgId, orgId)).orderBy(desc(schema.creditEntries.createdAt)).limit(50);
  return (
    <>
      <BuyCredits balance={balance} walletPaise={wallet} gstBps={Number(gst?.value ?? 1800)} packs={packs.map((p) => ({ id: p.id, credits: p.credits, unitPricePaise: p.unitPricePaise }))} />
      <p className="small mt8"><Link className="link" href="/portal/notifications/">Notification preferences →</Link></p>
      <div className="card p0 tbl-wrap mt12">
        <table className="tbl">
          <thead><tr><th>Date</th><th>Type</th><th>Reference</th><th style={{ textAlign: "right" }}>Credits</th><th style={{ textAlign: "right" }}>Paid</th></tr></thead>
          <tbody>
            {hist.length === 0 && <tr><td colSpan={5} className="muted small center">No credit activity yet.</td></tr>}
            {hist.map((h) => <tr key={h.id}><td className="small">{d(h.createdAt)}</td><td className="small">{h.kind}</td><td className="tiny mono muted">{h.refId ?? "—"}</td><td style={{ textAlign: "right" }} className={h.credits > 0 ? "t-credit b" : "t-debit b"}>{h.credits > 0 ? "+" : ""}{h.credits}</td><td style={{ textAlign: "right" }} className="small">{h.pricePaise ? formatINR(h.pricePaise + (h.gstPaise ?? 0)) : "—"}</td></tr>)}
          </tbody>
        </table>
      </div>
    </>
  );
}

async function Disputes({ orgId }: { orgId: string }) {
  const db = await getDb();
  const rows = await db.select({ w: schema.weightDisputes, s: schema.shipments }).from(schema.weightDisputes).innerJoin(schema.shipments, eq(schema.shipments.id, schema.weightDisputes.shipmentId)).where(eq(schema.weightDisputes.orgId, orgId)).orderBy(desc(schema.weightDisputes.createdAt));
  if (!rows.length) return <div className="card empty"><p className="muted">No weight discrepancies. 🎉</p></div>;
  return (
    <div className="card p0 tbl-wrap">
      <table className="tbl">
        <thead><tr><th>AWB</th><th>Declared</th><th>Carrier measured</th><th>Revised chargeable</th><th>Extra charge</th><th>Evidence</th><th>Dispute by</th><th>Status</th></tr></thead>
        <tbody>
          {rows.map(({ w, s }) => (
            <tr key={w.id}>
              <td className="mono tiny">{s.awb}</td><td>{(w.declaredGrams / 1000).toFixed(2)} kg</td><td>{(w.carrierGrams / 1000).toFixed(2)} kg</td><td>{(w.revisedChargeableGrams / 1000).toFixed(2)} kg</td>
              <td>{formatINR(w.chargePaise)}</td><td className="small">{(w.evidence as Array<{ label: string }>).map((e) => e.label).join(", ") || "—"}</td>
              <td className="small">{d(w.deadlineAt)}</td>
              <td><span className={`chip ${w.status === "open" ? "c-weight_discrepancy" : w.status === "waived" ? "c-resolved" : "c-disputed"}`}>{w.status}</span>{w.status === "open" && <div className="mt8"><Link className="btn btn-sm btn-outline" href={`/portal/support/new/?awb=${s.awb}&category=weight_dispute`}>Dispute</Link></div>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function Cod({ orgId }: { orgId: string }) {
  const db = await getDb();
  const rows = await db.select({ o: schema.orders, s: schema.shipments }).from(schema.orders).innerJoin(schema.shipments, eq(schema.shipments.orderId, schema.orders.id))
    .where(and(eq(schema.orders.orgId, orgId), eq(schema.orders.paymentType, "cod"))).orderBy(desc(schema.orders.createdAt));
  const delivered = rows.filter((r) => r.s.status === "delivered");
  const expected = delivered.reduce((s, r) => s + r.o.codAmountPaise, 0);
  return (
    <>
      <div className="stats mb12">
        <div className="stat bl-blue"><div className="t">COD delivered (expected)</div><div className="v">{formatINR(expected)}</div><div className="s">{delivered.length} shipments</div></div>
        <div className="stat bl-green"><div className="t">Remitted</div><div className="v">{formatINR(0)}</div><div className="s">Settlement refs appear here</div></div>
        <div className="stat bl-yellow"><div className="t">Pending remittance</div><div className="v">{formatINR(expected)}</div><div className="s">Per remittance cycle</div></div>
      </div>
      <div className="card p0 tbl-wrap">
        <table className="tbl">
          <thead><tr><th>Order</th><th>AWB</th><th>Status</th><th style={{ textAlign: "right" }}>COD amount</th><th>Remittance</th></tr></thead>
          <tbody>{rows.map(({ o, s }) => <tr key={o.id}><td>{o.orderNumber}</td><td className="mono tiny">{s.awb}</td><td className="small">{s.status.replace(/_/g, " ")}</td><td style={{ textAlign: "right" }}>{formatINR(o.codAmountPaise)}</td><td className="small muted">{s.status === "delivered" ? "Awaiting carrier remittance" : "Not yet collected"}</td></tr>)}</tbody>
        </table>
      </div>
      <p className="tiny muted mt8">Buyer COD amounts are tracked separately from your shipping wallet and notification credits. Remittance states change only on carrier settlement evidence or an approved operations entry.</p>
    </>
  );
}
