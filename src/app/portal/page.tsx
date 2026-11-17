import Link from "next/link";
import { Calculator, CornerUpLeft, MessageSquare, PackagePlus, Plus, Search, ShieldAlert, Ticket, Truck, Wallet, Zap } from "lucide-react";
import { formatINR } from "@/lib/money";
import { carrierLogo } from "@/lib/site";
import { StatusChip } from "@/lib/status";
import { portalContext } from "@/server/portal/context";
import { listOrders, recentTransactions, statusCounts } from "@/server/portal/queries";

const QUICK = [
  { href: "/portal/orders/new/", label: "Add Order", icon: Plus },
  { href: "/portal/orders/new/?quick=1", label: "Quick Add", icon: Zap },
  { href: "/portal/orders/new/?direction=reverse", label: "Return", icon: CornerUpLeft },
  { href: "/portal/billing/?recharge=1", label: "Recharge", icon: Wallet },
  { href: "/portal/rates/", label: "Rate Calculator", icon: Calculator },
  { href: "/portal/track/", label: "Track", icon: Truck },
  { href: "/portal/support/", label: "Tickets", icon: Ticket },
  { href: "/portal/notifications/", label: "Shipping Notifications", icon: MessageSquare },
];

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const sp = await searchParams;
  const ctx = await portalContext();
  const [counts, recent, txns] = await Promise.all([
    statusCounts(ctx.org.id), listOrders(ctx.org.id, { pageSize: 6 }), recentTransactions(ctx.walletId),
  ]);
  return (
    <>
      <div className="row between wrap mb16" style={{ gap: 12 }}>
        <div>
          <h1 style={{ fontSize: 22, margin: 0 }}>{sp.welcome ? "Welcome to Vishwaship" : `Hello, ${ctx.session.name.split(" ")[0]}`}</h1>
          <p className="muted small" style={{ margin: "4px 0 0" }}>{ctx.org.businessName}</p>
        </div>
        <Link className="btn btn-orange" href="/portal/orders/new/"><PackagePlus size={16} /> Add Order</Link>
      </div>

      <form className="mh-search mb16" action="/portal/orders/" role="search">
        <Search size={18} aria-hidden /><label htmlFor="dq" className="sr-only">Search</label>
        <input id="dq" name="q" placeholder="Search order ID, AWB / LR or buyer phone" />
      </form>

      <section aria-labelledby="qa-h" className="card mb16" style={{ padding: 16 }}>
        <h2 id="qa-h" className="b small mb12" style={{ margin: 0 }}>Quick actions</h2>
        <div className="qa-list">
          {QUICK.map((q) => <Link key={q.label} href={q.href} className="qa-item"><span className="qa-ic"><q.icon size={18} /></span>{q.label}</Link>)}
        </div>
      </section>

      <div className="grid2 mb16" style={{ gap: 12 }}>
        <div className="stat bl-orange">
          <div className="t"><Wallet size={14} /> Wallet balance</div>
          <div className="v">{formatINR(ctx.walletAvailable)}</div>
          <div className="s">{ctx.walletReserved > 0 ? `${formatINR(ctx.walletReserved)} on hold for bookings · ` : ""}<Link className="link" href="/portal/billing/?recharge=1">Recharge</Link></div>
        </div>
        <div className="stat bl-navy">
          <div className="t"><MessageSquare size={14} /> Notification credits</div>
          <div className="v">{ctx.credits.toLocaleString("en-IN")}</div>
          <div className="s"><Link className="link" href="/portal/billing/?tab=credits">Buy credits</Link> · <Link className="link-navy" href="/portal/notifications/">Preferences</Link></div>
        </div>
      </div>

      {ctx.org.kycStatus !== "approved" && (
        <Link href="/portal/kyc/" className="note row mb16" style={{ gap: 10, alignItems: "center" }}>
          <ShieldAlert size={18} />
          <span><b>{ctx.org.kycStatus === "pending" ? "KYC under review" : ctx.org.kycStatus === "changes_requested" ? "KYC changes requested" : ctx.org.kycStatus === "rejected" ? "KYC rejected" : "Complete your KYC"}</b> — {ctx.org.kycStatus === "pending" ? "we’ll notify you once approved." : "required for COD and remittances. Takes 2 minutes."}</span>
        </Link>
      )}

      <section aria-label="Shipments by status" className="stats mb16 dash-tiles">
        {counts.map((c) => (
          <Link key={c.key} className="stat plain stat-link" href={`/portal/orders/?group=${c.key}`}>
            <div className="t">{c.label}</div><div className="v">{c.count}</div>
          </Link>
        ))}
      </section>

      <div className="split dash-panels" style={{ gap: 16, alignItems: "start" }}>
        <section className="card p0" aria-labelledby="ro-h">
          <div className="row between card-h"><h2 id="ro-h" className="b" style={{ fontSize: 15, margin: 0 }}>Recent orders</h2><Link className="link small" href="/portal/orders/">View all</Link></div>
          {recent.rows.length === 0 ? (
            <div className="empty"><p className="muted">No orders yet.</p><Link className="btn btn-orange btn-sm" href="/portal/orders/new/">Create your first order</Link></div>
          ) : (
            <ul className="plain-list">
              {recent.rows.map((r) => {
                const logo = r.carrierCode ? carrierLogo(r.carrierCode) : null;
                return (
                  <li key={r.orderId}>
                    <Link href={`/portal/orders/${r.orderId}/`} className="row between" style={{ gap: 10 }}>
                      <span className="row" style={{ gap: 10, minWidth: 0 }}>
                        {logo ? <img className="clogo-sm" src={logo} alt={r.carrierName ?? ""} /> : null}
                        <span style={{ minWidth: 0 }}><span className="b small">{r.orderNumber}</span><span className="tiny muted mono" style={{ display: "block" }}>{r.awb ?? "Not booked"}</span></span>
                      </span>
                      {r.status ? <StatusChip status={r.status} /> : <span className="chip c-draft">{r.orderStatus}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section className="card p0" aria-labelledby="rt-h">
          <div className="row between card-h"><h2 id="rt-h" className="b" style={{ fontSize: 15, margin: 0 }}>Recent transactions</h2><Link className="link small" href="/portal/billing/">Passbook</Link></div>
          {txns.length === 0 ? <div className="empty"><p className="muted">No wallet activity yet.</p></div> : (
            <ul className="plain-list">
              {txns.map((t) => (
                <li key={t.id} className="row between" style={{ gap: 10 }}>
                  <span><span className="small b">{t.memo ?? t.kind.replace(/_/g, " ")}</span><span className="tiny muted" style={{ display: "block" }}>{t.createdAt.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short" })}</span></span>
                  <span className={t.amountPaise > 0 ? "b small t-credit" : t.amountPaise < 0 ? "b small t-debit" : "small muted"}>{t.amountPaise === 0 ? `hold ${formatINR(Math.abs(t.holdDeltaPaise))}` : (t.amountPaise > 0 ? "+" : "") + formatINR(t.amountPaise)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
