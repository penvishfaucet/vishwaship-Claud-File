import Link from "next/link";
import { and, count, desc, eq, ilike, or, sql } from "drizzle-orm";
import { LogIn, Wallet } from "lucide-react";
import { formatINR } from "@/lib/money";
import { loginAsCustomer } from "@/server/admin/impersonate";
import { can } from "@/server/auth/rbac";
import { requireStaff } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";

export const dynamic = "force-dynamic";
const PAGE = 50;
const KYC_LABEL: Record<string, string> = { not_started: "KYC not started", pending: "KYC under review", approved: "KYC approved", changes_requested: "KYC changes needed", rejected: "KYC rejected" };
const KYC_CHIP: Record<string, string> = { approved: "c-active", pending: "c-pending", changes_requested: "c-awaiting_customer", rejected: "c-failed", not_started: "c-draft" };
const ago = (d: Date | null) => {
  if (!d) return "—";
  const m = Math.round((Date.now() - +d) / 60000);
  return m < 60 ? `${Math.max(1, m)} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : m < 43200 ? `${Math.round(m / 1440)} days ago` : d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });
};

/** Admin → Customers: compact, searchable directory. One row per account; details live on the customer page. */
export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; kyc?: string; status?: string; sort?: string; page?: string }> }) {
  const sp = await searchParams;
  const s = await requireStaff("customers.read");
  const canLoginAs = can(s.role, "customers.impersonate");
  const showWallet = can(s.role, "finance.read");
  const db = await getDb();
  const O = schema.orgs, U = schema.users;
  const q = sp.q?.trim() ? `%${sp.q.trim().replace(/[%_\\]/g, "")}%` : null;
  const digits = sp.q?.replace(/\D/g, "") ?? "";
  const where = and(
    q ? or(ilike(O.businessName, q), ilike(O.id, q), ilike(O.gstin, q),
      sql`exists (select 1 from ${U} u where u.org_id = ${O.id} and (u.email ilike ${q} or u.name ilike ${q}${digits.length >= 4 ? sql` or u.mobile like ${`%${digits.slice(-10)}%`}` : sql``}))`) : undefined,
    sp.kyc ? eq(O.kycStatus, sp.kyc as never) : undefined,
    sp.status === "active" || sp.status === "suspended" ? eq(O.status, sp.status) : undefined,
  );
  const page = Math.max(1, Number(sp.page) || 1);
  const avail = sql<number>`coalesce(${schema.wallets.postedPaise} - ${schema.wallets.reservedPaise}, 0)`;
  const lastActivity = sql<Date | null>`greatest((select max(o2.created_at) from ${schema.orders} o2 where o2.org_id = ${O.id}), (select max(l.created_at) from ${schema.ledgerEntries} l where l.wallet_id = ${schema.wallets.id}))`;
  const rows = await db.select({
    o: O, available: avail, reserved: schema.wallets.reservedPaise,
    shipments: sql<number>`(select count(*)::int from ${schema.shipments} x where x.org_id = ${O.id})`,
    last: lastActivity,
    contactName: sql<string | null>`(select u.name from ${U} u where u.org_id = ${O.id} and u.kind = 'customer' order by u.created_at limit 1)`,
    contactEmail: sql<string | null>`(select u.email from ${U} u where u.org_id = ${O.id} and u.kind = 'customer' order by u.created_at limit 1)`,
    contactMobile: sql<string | null>`(select u.mobile from ${U} u where u.org_id = ${O.id} and u.kind = 'customer' order by u.created_at limit 1)`,
  }).from(O).leftJoin(schema.wallets, eq(schema.wallets.orgId, O.id)).where(where)
    .orderBy(sp.sort === "wallet" ? desc(avail) : sp.sort === "activity" ? sql`${lastActivity} desc nulls last` : desc(O.createdAt)).limit(PAGE).offset((page - 1) * PAGE);
  const [{ total }] = await db.select({ total: count() }).from(O).where(where);
  const [tot] = await db.select({ a: sql<number>`coalesce(sum(${schema.wallets.postedPaise} - ${schema.wallets.reservedPaise}), 0)::bigint`, h: sql<number>`coalesce(sum(${schema.wallets.reservedPaise}), 0)::bigint` }).from(O).leftJoin(schema.wallets, eq(schema.wallets.orgId, O.id)).where(where);
  const qs = (p: Record<string, string | undefined>) => `/admin/customers/?${new URLSearchParams(Object.entries({ ...sp, ...p }).filter(([, v]) => v) as [string, string][])}`;
  const pages = Math.max(1, Math.ceil(Number(total) / PAGE));
  return (
    <>
      <div className="page-h"><div><h1>Customers</h1><p className="small muted" style={{ margin: "4px 0 0" }}>{Number(total).toLocaleString("en-IN")} account{Number(total) === 1 ? "" : "s"}{sp.q || sp.kyc || sp.status ? " match" : ""}. Open a customer for shipments, passbook, KYC and billing.</p></div></div>
      {showWallet && (
        <div className="stats mb12">
          <div className="stat bl-orange"><div className="t"><Wallet size={14} /> Wallet balance (available)</div><div className="v">{formatINR(Number(tot.a))}</div><div className="s">{sp.q || sp.kyc || sp.status ? "Filtered customers" : "All customers"}</div></div>
          <div className="stat bl-blue"><div className="t">On hold for bookings</div><div className="v">{formatINR(Number(tot.h))}</div></div>
        </div>
      )}
      <form className="card cu-filters mb12" role="search">
        <div className="field cu-q"><label htmlFor="cq">Search</label><input id="cq" name="q" className="input" defaultValue={sp.q} placeholder="Company, customer ID, GSTIN, email or mobile" /></div>
        <div className="field"><label htmlFor="ck">KYC</label><select id="ck" name="kyc" className="select" defaultValue={sp.kyc ?? ""}><option value="">Any KYC</option>{Object.entries(KYC_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        <div className="field"><label htmlFor="cs">Account</label><select id="cs" name="status" className="select" defaultValue={sp.status ?? ""}><option value="">Any</option><option value="active">Active</option><option value="suspended">Suspended</option></select></div>
        <div className="field"><label htmlFor="co">Sort</label><select id="co" name="sort" className="select" defaultValue={sp.sort ?? ""}><option value="">Newest first</option><option value="activity">Recent activity</option>{showWallet && <option value="wallet">Highest wallet balance</option>}</select></div>
        <div className="row" style={{ gap: 8, alignItems: "end" }}><button className="btn btn-navy">Search</button><Link className="btn btn-outline" href="/admin/customers/">Reset</Link></div>
      </form>
      <div className="card p0 tbl-wrap"><table className="tbl cu-tbl">
        <thead><tr><th>Customer</th><th>Contact</th><th>Status</th>{showWallet && <th className="r">Wallet</th>}<th className="r">Shipments</th><th>Last activity</th>{canLoginAs && <th><span className="sr-only">Login as customer</span></th>}</tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={7} className="center small muted">No customers match.</td></tr>}
          {rows.map((r) => (
            <tr key={r.o.id}>
              <td><Link className="b link-navy" href={`/admin/customers/${r.o.id}/`}>{r.o.businessName}</Link><div className="tiny muted mono">{r.o.id}</div></td>
              <td className="small">{r.contactName ?? "—"}<div className="tiny muted">{[r.contactEmail, r.contactMobile].filter(Boolean).join(" · ") || "—"}</div></td>
              <td><span className={`chip ${r.o.status === "active" ? "c-active" : "c-cancelled"}`}>{r.o.status === "active" ? "Active" : "Suspended"}</span> <span className={`chip ${KYC_CHIP[r.o.kycStatus] ?? "c-pending"}`}>{KYC_LABEL[r.o.kycStatus] ?? r.o.kycStatus}</span></td>
              {showWallet && <td className="r nowrap"><Link className="b link-navy" href={`/admin/customers/${r.o.id}/?tab=wallet`}>{formatINR(Number(r.available))}</Link>{r.reserved ? <div className="tiny muted">+ {formatINR(r.reserved)} on hold</div> : null}</td>}
              <td className="r"><Link className="link-navy" href={`/admin/shipments/?customer=${r.o.id}&from=2020-01-01`}>{Number(r.shipments).toLocaleString("en-IN")}</Link></td>
              <td className="small nowrap">{ago(r.last ? new Date(r.last) : null)}</td>
              {canLoginAs && <td><form action={loginAsCustomer}><input type="hidden" name="orgId" value={r.o.id} /><button className="btn btn-sm btn-outline" title={`Open ${r.o.businessName}'s customer portal`}><LogIn size={14} /> Login as</button></form></td>}
            </tr>
          ))}
        </tbody>
      </table></div>
      <nav className="row between mt12" aria-label="Pages"><span className="small muted">Page {page} of {pages}</span><span className="row" style={{ gap: 8 }}>{page > 1 && <Link className="btn btn-sm btn-outline" href={qs({ page: String(page - 1) })}>Previous</Link>}{page < pages && <Link className="btn btn-sm btn-outline" href={qs({ page: String(page + 1) })}>Next</Link>}</span></nav>
    </>
  );
}
