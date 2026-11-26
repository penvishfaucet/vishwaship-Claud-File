import Link from "next/link";
import { type Column, and, count, desc, eq, gte, inArray, lt, notInArray, sum } from "drizzle-orm";
import { CustomerOverview } from "@/components/admin/CustomerOverview";
import { formatINR } from "@/lib/money";
import { pnlByOrg } from "@/server/finance/pnl";
import { ownAccountIds } from "@/server/finance/own-accounts";
import { can } from "@/server/auth/rbac";
import { requireStaff } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";

export default async function AdminDashboard({ searchParams }: { searchParams: Promise<{ days?: string; denied?: string; from?: string; to?: string; customer?: string; q?: string }> }) {
  const sp = await searchParams;
  const s = await requireStaff("shipments.read");
  const days = [1, 7, 30, 90].includes(Number(sp.days)) ? Number(sp.days) : 30;
  const since = new Date(Date.now() - days * 86400_000);
  const db = await getDb();
  // the owner's own accounts are left out of the figures (they still show in their own customer pages)
  const own = await ownAccountIds();
  const notOwn = (col: Column) => (own.length ? notInArray(col, own) : undefined);
  const [tot] = await db.select({ n: count(), sell: sum(schema.shipments.sellPaise), cost: sum(schema.shipments.costPaise) }).from(schema.shipments).where(and(gte(schema.shipments.createdAt, since), notOwn(schema.shipments.orgId)));
  const byStatus = await db.select({ status: schema.shipments.status, n: count() }).from(schema.shipments).where(and(gte(schema.shipments.createdAt, since), notOwn(schema.shipments.orgId))).groupBy(schema.shipments.status);
  const st = (k: string[]) => byStatus.filter((r) => k.includes(r.status)).reduce((t, r) => t + Number(r.n), 0);
  const [{ customers }] = await db.select({ customers: count() }).from(schema.orgs).where(notOwn(schema.orgs.id));
  const [{ kyc }] = await db.select({ kyc: count() }).from(schema.orgs).where(and(eq(schema.orgs.kycStatus, "pending"), notOwn(schema.orgs.id)));
  const [{ reconcile }] = await db.select({ reconcile: count() }).from(schema.orders).where(inArray(schema.orders.status, ["needs_reconcile", "booking_failed"]));
  const [{ overdueNdr }] = await db.select({ overdueNdr: count() }).from(schema.ndrCases).where(and(eq(schema.ndrCases.status, "open"), lt(schema.ndrCases.deadlineAt, new Date(Date.now() + 12 * 3600_000))));
  const [{ disputes }] = await db.select({ disputes: count() }).from(schema.weightDisputes).where(eq(schema.weightDisputes.status, "open"));
  const [{ tickets }] = await db.select({ tickets: count() }).from(schema.tickets).where(eq(schema.tickets.status, "open"));
  const [{ mismatch }] = await db.select({ mismatch: count() }).from(schema.recharges).where(eq(schema.recharges.status, "mismatch"));
  const [{ stale }] = await db.select({ stale: count() }).from(schema.shipments).where(and(inArray(schema.shipments.status, ["in_transit", "picked_up"]), lt(schema.shipments.lastEventAt, new Date(Date.now() - 72 * 3600_000))));
  const activity = await db.select().from(schema.auditLog).orderBy(desc(schema.auditLog.createdAt)).limit(10);
  const showMoney = can(s.role, "shipments.cost.read");
  const sell = Number(tot.sell ?? 0), cost = Number(tot.cost ?? 0);
  const pnl = showMoney ? (await pnlByOrg({ from: since, to: new Date() })).total : null;

  const Tile = ({ href, label, value, tone }: { href: string; label: string; value: string | number; tone: string }) => (
    <Link className={`stat ${tone} stat-link`} href={href}><div className="t">{label}</div><div className="v">{value}</div></Link>
  );
  return (
    <>
      {sp.denied && <p className="err mb12" role="alert">Your role doesn’t have access to that section ({sp.denied}).</p>}
      <div className="page-h"><h1>Dashboard</h1></div>
      <CustomerOverview sp={sp} contacts={can(s.role, "customers.read")} own={own} />
      <div className="page-h">
        <h2 className="b" style={{ fontSize: 18, margin: 0 }}>Operations</h2>
        <div className="pills">{[1, 7, 30, 90].map((d) => <Link key={d} className={d === days ? "pill on" : "pill"} href={`/admin/?days=${d}`}>{d === 1 ? "Today" : `${d} days`}</Link>)}</div>
      </div>
      <div className="stats mb16">
        <Tile href="/admin/shipments/" label={`Shipments (${days}d)`} value={Number(tot.n)} tone="bl-navy" />
        <Tile href="/admin/shipments/?status=delivered" label="Delivered" value={st(["delivered"])} tone="bl-green" />
        <Tile href="/admin/ndr/" label="NDR" value={st(["ndr"])} tone="bl-red" />
        <Tile href="/admin/shipments/?status=rto" label="RTO" value={st(["rto_initiated", "rto_in_transit", "rto_delivered"])} tone="bl-purple" />
        {showMoney && <Tile href="/admin/reports/" label="Revenue (incl. GST)" value={formatINR(sell)} tone="bl-orange" />}
        {showMoney && <Tile href="/admin/reports/" label="Carrier cost (pre-tax)" value={formatINR(cost)} tone="bl-blue" />}
        {pnl && <Tile href="/admin/pnl/" label={`${pnl.profit < 0 ? "Loss" : "Profit"} (excl. GST) · ${pnl.marginPct ?? 0}%`} value={`${pnl.profit < 0 ? "−" : ""}${formatINR(Math.abs(pnl.profit))}`} tone={pnl.profit < 0 ? "bl-red" : "bl-green"} />}
        <Tile href="/admin/customers/" label="Customers" value={Number(customers)} tone="bl-navy" />
        <Tile href="/admin/kyc/" label="KYC pending" value={Number(kyc)} tone="bl-yellow" />
      </div>
      <div className="split" style={{ gap: 16, alignItems: "start" }}>
        <section className="card p0">
          <h2 className="b small card-h" style={{ margin: 0 }}>Exception queues</h2>
          <ul className="plain-list">
            {[
              ["Pending / ambiguous bookings", reconcile, "/admin/shipments/?exception=booking"],
              ["Tracking gaps (no scan 72h)", stale, "/admin/shipments/?exception=stale"],
              ["NDR due within 12h", overdueNdr, "/admin/ndr/"],
              ["Open weight disputes", disputes, "/admin/disputes/"],
              ["Open tickets", tickets, "/admin/tickets/"],
              ["Recharge mismatches", mismatch, "/admin/finance/?tab=recharges"],
            ].map(([l, n, h]) => <li key={String(l)}><Link className="row between" href={String(h)}><span className="small">{l}</span><span className={`chip ${Number(n) ? "c-urgent" : "c-resolved"}`}>{String(n)}</span></Link></li>)}
          </ul>
        </section>
        <section className="card p0">
          <h2 className="b small card-h" style={{ margin: 0 }}>Recent activity</h2>
          <ul className="plain-list">
            {activity.map((a) => <li key={a.id} className="row between"><span className="small">{a.action}{a.orgId ? <span className="muted"> · {a.orgId}</span> : null}</span><span className="tiny muted">{a.createdAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</span></li>)}
          </ul>
        </section>
      </div>
      <p className="tiny muted mt12">All figures are across every customer except own accounts{own.length ? ` (${own.length})` : ""}, which are marked on the customer’s page; exception queues include them. Finance figures are shown only to roles with cost access.</p>
    </>
  );
}
