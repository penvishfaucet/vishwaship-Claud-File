import Link from "next/link";
import { desc, eq, gt } from "drizzle-orm";
import { formatINR } from "@/lib/money";
import { requireStaff } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";

async function replay(fd: FormData) {
  "use server";
  const s = await requireStaff("finance.adjust");
  const { replayJob } = await import("@/server/jobs/runner");
  const { audit } = await import("@/server/audit");
  await replayJob(String(fd.get("id")));
  await audit({ actorUserId: s.userId, actorKind: "staff", action: "job.replay", targetType: "job", targetId: String(fd.get("id")) });
  const { redirect } = await import("next/navigation");
  redirect("/admin/finance/?tab=reconciliation");
}

const TABS = [["wallets", "Wallets"], ["recharges", "Recharges"], ["adjustments", "Adjustments"], ["cod", "COD"], ["reconciliation", "Reconciliation"]] as const;

export default async function Finance({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const sp = await searchParams;
  await requireStaff("finance.read");
  const tab = TABS.find(([k]) => k === sp.tab)?.[0] ?? "wallets";
  const db = await getDb();
  return (
    <>
      <div className="page-h"><h1>Finance</h1></div>
      <nav className="tabs">{TABS.map(([k, l]) => <Link key={k} href={`/admin/finance/?tab=${k}`} className={tab === k ? "on" : ""}>{l}</Link>)}</nav>
      {tab === "wallets" && await (async () => {
        const rows = await db.select({ w: schema.wallets, o: schema.orgs }).from(schema.wallets).innerJoin(schema.orgs, eq(schema.orgs.id, schema.wallets.orgId));
        const tot = rows.reduce((t, r) => t + r.w.postedPaise, 0);
        return <div className="card p0 tbl-wrap"><table className="tbl"><thead><tr><th>Customer</th><th className="r">Posted</th><th className="r">On hold</th><th className="r">Available</th></tr></thead>
          <tbody>{rows.map(({ w, o }) => <tr key={w.id}><td><Link className="link-navy" href={`/admin/customers/${o.id}/?tab=wallet`}>{o.businessName}</Link></td><td className="r">{formatINR(w.postedPaise)}</td><td className="r">{formatINR(w.reservedPaise)}</td><td className="r">{formatINR(w.postedPaise - w.reservedPaise)}</td></tr>)}</tbody>
          <tfoot><tr><td className="b">Total customer liability</td><td className="r b">{formatINR(tot)}</td><td /><td /></tr></tfoot></table></div>;
      })()}
      {tab === "recharges" && await (async () => {
        const rows = await db.select({ r: schema.recharges, o: schema.orgs }).from(schema.recharges).innerJoin(schema.orgs, eq(schema.orgs.id, schema.recharges.orgId)).orderBy(desc(schema.recharges.createdAt)).limit(200);
        return rows.length === 0 ? <div className="card empty"><p className="muted">No recharges yet.</p></div> : <div className="card p0 tbl-wrap"><table className="tbl"><thead><tr><th>Date</th><th>Customer</th><th>Razorpay order</th><th>Payment</th><th className="r">Amount</th><th>Status</th></tr></thead>
          <tbody>{rows.map(({ r, o }) => <tr key={r.id}><td className="small">{r.createdAt.toLocaleString("en-IN")}</td><td className="small">{o.businessName}</td><td className="mono tiny">{r.razorpayOrderId}</td><td className="mono tiny">{r.razorpayPaymentId ?? "—"}</td><td className="r">{formatINR(r.amountPaise)}</td><td><span className={`chip ${r.status === "captured" ? "c-paid" : r.status === "mismatch" ? "c-urgent" : "c-pending"}`}>{r.status}{r.razorpayOrderId?.startsWith("demo_") ? " (demo)" : ""}</span></td></tr>)}</tbody></table></div>;
      })()}
      {tab === "adjustments" && await (async () => {
        const rows = await db.select().from(schema.ledgerEntries).where(eq(schema.ledgerEntries.refType, "staff")).orderBy(desc(schema.ledgerEntries.createdAt)).limit(200);
        return rows.length === 0 ? <div className="card empty"><p className="muted">No manual adjustments. Post them from a customer’s Wallet tab (Finance role).</p></div> : <div className="card p0 tbl-wrap"><table className="tbl"><thead><tr><th>Date</th><th>Kind</th><th>Memo</th><th>By</th><th className="r">Amount</th></tr></thead><tbody>{rows.map((l) => <tr key={l.id}><td className="small">{l.createdAt.toLocaleString("en-IN")}</td><td className="small">{l.kind}</td><td className="small">{l.memo}</td><td className="mono tiny">{l.refId}</td><td className="r">{formatINR(l.amountPaise)}</td></tr>)}</tbody></table></div>;
      })()}
      {tab === "cod" && await (async () => {
        const rows = await db.select({ o: schema.orders, s: schema.shipments, org: schema.orgs }).from(schema.orders).innerJoin(schema.shipments, eq(schema.shipments.orderId, schema.orders.id)).innerJoin(schema.orgs, eq(schema.orgs.id, schema.orders.orgId)).where(gt(schema.orders.codAmountPaise, 0));
        const delivered = rows.filter((r) => r.s.status === "delivered");
        return <>
          <div className="stats mb12"><div className="stat bl-blue"><div className="t">Expected (delivered COD)</div><div className="v">{formatINR(delivered.reduce((t, r) => t + r.o.codAmountPaise, 0))}</div></div><div className="stat bl-green"><div className="t">Received from carriers</div><div className="v">{formatINR(0)}</div></div><div className="stat bl-yellow"><div className="t">Remitted to customers</div><div className="v">{formatINR(0)}</div></div></div>
          <div className="card p0 tbl-wrap"><table className="tbl"><thead><tr><th>Customer</th><th>Order</th><th>AWB</th><th>Status</th><th className="r">COD</th><th>Settlement ref</th></tr></thead><tbody>{rows.map(({ o, s, org }) => <tr key={o.id}><td className="small">{org.businessName}</td><td>{o.orderNumber}</td><td className="mono tiny">{s.awb}</td><td className="small">{s.status}</td><td className="r">{formatINR(o.codAmountPaise)}</td><td className="small muted">— awaiting carrier settlement file</td></tr>)}</tbody></table></div>
          <p className="tiny muted mt8">Remittance states change only from carrier settlement evidence (upload) or an approved operations entry. No payout is automated.</p>
        </>;
      })()}
      {tab === "reconciliation" && await (async () => {
        const amb = await db.select().from(schema.orders).where(eq(schema.orders.status, "needs_reconcile"));
        const mm = await db.select().from(schema.recharges).where(eq(schema.recharges.status, "mismatch"));
        const dead = await db.select().from(schema.jobs).where(eq(schema.jobs.status, "dead")).orderBy(desc(schema.jobs.createdAt)).limit(50);
        return <div className="grid2" style={{ gap: 12 }}>
          <section className="card" style={{ padding: 16 }}><b>Ambiguous bookings</b><p className="small muted">Funds held; resolved by courier lookup before any retry.</p>{amb.length ? amb.map((o) => <p key={o.id} className="small">{o.orderNumber}</p>) : <p className="small">None 🎉</p>}</section>
          <section className="card" style={{ padding: 16 }}><b>Recharge mismatches</b><p className="small muted">Captured amount/currency differs from the order; not credited.</p>{mm.length ? mm.map((r) => <p key={r.id} className="small mono">{r.razorpayPaymentId}</p>) : <p className="small">None 🎉</p>}</section>
          <section className="card" style={{ padding: 16, gridColumn: "1 / -1" }}><b>Dead-letter jobs</b><p className="small muted">Jobs that failed after all retries. Replay re-runs them safely (handlers are idempotent).</p>
            {dead.length ? dead.map((j) => <form key={j.id} action={replay} className="row between" style={{ gap: 8, padding: "6px 0" }}><input type="hidden" name="id" value={j.id} /><span className="small"><b>{j.queue}</b> · {j.lastError}</span><button className="btn btn-sm btn-outline">Replay</button></form>) : <p className="small">None 🎉</p>}</section>
        </div>;
      })()}
    </>
  );
}
