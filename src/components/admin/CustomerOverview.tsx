import Link from "next/link";
import { Suspense } from "react";
import { inArray } from "drizzle-orm";
import { CustomerPicker } from "@/components/admin/CustomerPicker";
import { DASH_ICONS } from "@/components/portal/DashIcons";
import { DateRangePicker } from "@/components/portal/DateRangePicker";
import { formatINR } from "@/lib/money";
import { getDb, schema } from "@/server/db/client";
import { BUCKETS, type BucketKey, bucketCounts, bucketCountsByOrg, dashRange } from "@/server/portal/buckets";

/** The Customer Portal's cards, for every customer at once (or one picked customer). */
const CARDS: Array<{ key: BucketKey; tone: string }> = [
  { key: "new", tone: "blue" }, { key: "assigned", tone: "orange" }, { key: "scheduled", tone: "teal" }, { key: "in_transit", tone: "blue" },
  { key: "delivered", tone: "teal" }, { key: "all", tone: "blue" }, { key: "returns", tone: "red" }, { key: "rto", tone: "yellow" },
];
/** Columns of the customer-wise table. */
const COLS: Array<{ key: BucketKey; short: string }> = [
  { key: "all", short: "All" }, { key: "new", short: "New" }, { key: "assigned", short: "Assigned" }, { key: "scheduled", short: "Scheduled" },
  { key: "in_transit", short: "In transit" }, { key: "ofd", short: "Out for delivery" }, { key: "delivered", short: "Delivered" },
  { key: "ndr", short: "NDR" }, { key: "rto", short: "RTO" }, { key: "returns", short: "Returns" },
];
const KYC: Record<string, string> = { not_started: "Not started", pending: "Pending", approved: "Approved", rejected: "Rejected", changes_requested: "Changes asked" };
const kycTone = (k: string) => (k === "approved" ? "c-delivered" : k === "rejected" ? "c-ndr" : "c-pending");
const day = (d: Date) => d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" });

/** contacts: staff with customers.read also see each customer's login, email, mobile and wallet. */
export async function CustomerOverview({ sp, contacts }: { sp: { from?: string; to?: string; customer?: string; q?: string }; contacts: boolean }) {
  const r = dashRange(sp);
  const db = await getDb();
  const orgs = await db.select({ id: schema.orgs.id, name: schema.orgs.name, businessName: schema.orgs.businessName, gstin: schema.orgs.gstin, status: schema.orgs.status, kycStatus: schema.orgs.kycStatus, address: schema.orgs.address, createdAt: schema.orgs.createdAt }).from(schema.orgs);
  const ids = orgs.map((o) => o.id);
  const people = contacts && ids.length ? await db.select({ orgId: schema.users.orgId, name: schema.users.name, email: schema.users.email, mobile: schema.users.mobile, createdAt: schema.users.createdAt }).from(schema.users).where(inArray(schema.users.orgId, ids)) : [];
  const wallets = contacts && ids.length ? await db.select({ orgId: schema.wallets.orgId, posted: schema.wallets.postedPaise, reserved: schema.wallets.reservedPaise }).from(schema.wallets).where(inArray(schema.wallets.orgId, ids)) : [];
  // the account owner = the first login created for the customer
  const owner = new Map<string, (typeof people)[number]>();
  for (const p of [...people].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) if (p.orgId && !owner.has(p.orgId)) owner.set(p.orgId, p);
  const wallet = new Map(wallets.map((w) => [w.orgId, Number(w.posted) - Number(w.reserved)]));
  const label = (o: (typeof orgs)[number]) => o.businessName || o.name;

  const picked = orgs.find((o) => o.id === sp.customer) ?? null;
  const keys = [...new Set<BucketKey>([...CARDS.map((c) => c.key), ...COLS.map((c) => c.key)])];
  const [counts, byOrg] = await Promise.all([bucketCounts(picked?.id ?? null, r, keys), picked ? Promise.resolve(null) : bucketCountsByOrg(r, keys)]);
  const rq = `from=${r.fromStr}&to=${r.toStr}`;
  const list = (k: BucketKey, orgId?: string) => `/admin/shipments/?bucket=${k}&${rq}${orgId ? `&customer=${encodeURIComponent(orgId)}` : ""}`;

  const q = (sp.q ?? "").trim().toLowerCase().slice(0, 60);
  const rows = byOrg ? orgs
    .map((o) => ({ o, c: byOrg.get(o.id) ?? {}, u: owner.get(o.id) }))
    .filter(({ o, u }) => !q || [label(o), o.name, u?.name, u?.email, u?.mobile, o.gstin].some((v) => v?.toLowerCase().includes(q)))
    .sort((a, b) => (b.c.all ?? 0) - (a.c.all ?? 0) || label(a.o).localeCompare(label(b.o))) : [];
  const pu = picked ? owner.get(picked.id) : undefined;
  const addr = picked?.address as { city?: string; state?: string; pincode?: string } | null | undefined;

  return (
    <section className="mb16" aria-labelledby="co-h">
      <div className="row between wrap mb12" style={{ gap: 12 }}>
        <h2 id="co-h" className="b" style={{ fontSize: 18, margin: 0 }}>Customer shipments</h2>
        <div className="row wrap" style={{ gap: 10 }}>
          <Suspense fallback={null}><CustomerPicker customers={orgs.map((o) => ({ id: o.id, name: label(o) })).sort((a, b) => a.name.localeCompare(b.name))} value={picked?.id ?? ""} /></Suspense>
          <Suspense fallback={<span className="small muted">{r.fromStr} to {r.toStr}</span>}><DateRangePicker from={r.fromStr} to={r.toStr} /></Suspense>
        </div>
      </div>

      {picked && (
        <div className="card co-cust mb12">
          <div className="co-cust-main">
            <b style={{ fontSize: 16 }}>{label(picked)}</b>
            {contacts && <span className="small muted">{[pu?.name, pu?.email, pu?.mobile].filter(Boolean).join(" · ") || "No login yet"}</span>}
            <span className="small muted">{[picked.gstin ? `GSTIN ${picked.gstin}` : "No GSTIN", addr?.city ? `${addr.city}${addr.state ? `, ${addr.state}` : ""}${addr.pincode ? ` ${addr.pincode}` : ""}` : "", `Joined ${day(picked.createdAt)}`].filter(Boolean).join(" · ")}</span>
          </div>
          <div className="co-cust-side">
            <span className={`chip ${kycTone(picked.kycStatus)}`}>KYC {(KYC[picked.kycStatus] ?? picked.kycStatus).toLowerCase()}</span>
            {picked.status !== "active" && <span className="chip c-ndr">{picked.status}</span>}
            {contacts && <span className="small">Wallet <b>{formatINR(wallet.get(picked.id) ?? 0)}</b></span>}
            {contacts && <Link className="btn btn-sm btn-soft" href={`/admin/customers/${picked.id}/`}>Customer details</Link>}
            <Link className="btn btn-sm btn-outline" href={`/admin/?${rq}`}>All customers</Link>
          </div>
        </div>
      )}

      <div className="dash-cards mb16" aria-label={picked ? `${label(picked)} order summary` : "Order summary, all customers"}>
        {CARDS.map((c) => {
          const I = DASH_ICONS[c.key as keyof typeof DASH_ICONS];
          return (
            <Link key={c.key} href={list(c.key, picked?.id)} className={`dcard t-${c.tone}`} aria-label={`${BUCKETS[c.key].label}: ${counts[c.key]} — open list`}>
              {I && <I size={56} />}
              <span className="dl">{BUCKETS[c.key].label}</span>
              <span className="dn">{counts[c.key].toLocaleString("en-IN")}</span>
            </Link>
          );
        })}
      </div>

      {!picked && (
        <div className="card p0">
          <div className="row between wrap card-h" style={{ gap: 10 }}>
            <h3 className="b" style={{ fontSize: 15, margin: 0 }}>Customer-wise <span className="small muted">· orders created {r.fromStr} to {r.toStr}</span></h3>
            <form method="get" className="row" style={{ gap: 6 }}>
              <input type="hidden" name="from" value={r.fromStr} /><input type="hidden" name="to" value={r.toStr} />
              <input className="input" style={{ minWidth: 220 }} name="q" defaultValue={sp.q ?? ""} placeholder={contacts ? "Search name, email, mobile, GSTIN" : "Search customer name or GSTIN"} aria-label="Search customers" />
              <button className="btn btn-sm btn-outline" type="submit">Search</button>
            </form>
          </div>
          {rows.length === 0 ? <div className="empty"><p className="muted small">{q ? "No customer matches this search." : "No customers yet."}</p></div> : (
            <div className="tbl-wrap"><table className="tbl co-tbl">
              <thead><tr><th>Customer</th><th>KYC</th>{contacts && <th className="num">Wallet</th>}{COLS.map((c) => <th key={c.key} className="num">{c.short}</th>)}</tr></thead>
              <tbody>{rows.map(({ o, c, u }) => (
                <tr key={o.id}>
                  <td><Link className="b link-navy" href={`/admin/?customer=${encodeURIComponent(o.id)}&${rq}`}>{label(o)}</Link>{contacts && <div className="tiny muted">{[u?.name, u?.email, u?.mobile].filter(Boolean).join(" · ") || "No login yet"}</div>}</td>
                  <td><span className={`chip ${kycTone(o.kycStatus)}`}>{KYC[o.kycStatus] ?? o.kycStatus}</span></td>
                  {contacts && <td className="num small">{formatINR(wallet.get(o.id) ?? 0)}</td>}
                  {COLS.map((k) => { const n = c[k.key] ?? 0; return <td key={k.key} className="num">{n ? <Link className="link" href={list(k.key, o.id)}>{n.toLocaleString("en-IN")}</Link> : <span className="muted">0</span>}</td>; })}
                </tr>
              ))}</tbody>
              <tfoot><tr><th colSpan={contacts ? 3 : 2}>Total ({rows.length} customers)</th>{COLS.map((k) => <th key={k.key} className="num">{rows.reduce((t, x) => t + (x.c[k.key] ?? 0), 0).toLocaleString("en-IN")}</th>)}</tr></tfoot>
            </table></div>
          )}
        </div>
      )}
    </section>
  );
}
