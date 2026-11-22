import { ProcessSummaryCard } from "@/components/portal/store/ProcessSummaryCard";
import { hasFeature } from "@/server/features";
import { storeForOrg } from "@/server/store/service";
import { CopyBtn } from "@/components/portal/orders/ui";
import { AwbLink, OrderIdLink, portalOrderHref, portalTrackHref } from "@/components/IdLinks";
import Link from "next/link";
import { Suspense } from "react";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { Boxes, CalendarCheck, Download, PackageOpen, PackagePlus, RotateCcw, ShieldAlert, Truck, Undo2 } from "lucide-react";
import { DateRangePicker } from "@/components/portal/DateRangePicker";
import { formatINR } from "@/lib/money";
import { carrierLogo } from "@/lib/site";
import { StatusChip } from "@/lib/status";
import { t } from "@/server/content";
import { getDb, schema } from "@/server/db/client";
import { BUCKETS, type BucketKey, bucketCounts, dashRange, isBucket } from "@/server/portal/buckets";
import { portalContext } from "@/server/portal/context";
import { OfferStrip } from "@/components/site/OfferStrip";
import { DEFAULTS } from "@/lib/site-content";
import { getSiteContent } from "@/server/site/content";
import { listOrders } from "@/server/portal/queries";
import { DashSearch } from "@/components/portal/DashSearch";
import { redirect } from "next/navigation";
import { onboardingState, STEP_TEXT } from "@/server/onboarding";
import { DASH_ICONS, IcoCoin, IcoWallet } from "@/components/portal/DashIcons";
import { Bell, Wallet } from "lucide-react";

const CARDS: Array<{ key: BucketKey; icon: typeof Boxes; tone: string }> = [
  { key: "new", icon: PackagePlus, tone: "blue" },
  { key: "assigned", icon: PackageOpen, tone: "orange" },
  { key: "scheduled", icon: CalendarCheck, tone: "teal" },
  { key: "in_transit", icon: Truck, tone: "blue" },
  { key: "delivered", icon: PackageOpen, tone: "teal" },
  { key: "all", icon: Boxes, tone: "blue" },
  { key: "returns", icon: Undo2, tone: "red" },
  { key: "rto", icon: RotateCcw, tone: "yellow" },
];
const DONUT: Array<{ key: BucketKey; color: string }> = [
  { key: "delivered", color: "#4f9cf9" }, { key: "rto_in_transit", color: "#f4845f" }, { key: "rto_delivered", color: "#b5d334" }, { key: "ndr", color: "#f5a623" },
];
const PIPE: BucketKey[] = ["new", "assigned", "scheduled", "in_transit", "ofd", "delivered", "ndr", "rto"];
type SP = { tab?: string; from?: string; to?: string; stage?: string; welcome?: string; password?: string; google?: string };
const dt = (d: Date) => d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short" });

export default async function Dashboard({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await portalContext();
  const hasStore = (await hasFeature(ctx.org.id, "online_store")) && !!(await storeForOrg(ctx.org.id));
  const r = dashRange(sp);
  const tab = sp.tab === "status" ? "status" : "analytics";
  const rq = `from=${r.fromStr}&to=${r.toStr}`;
  const href = (b: BucketKey) => `/portal/orders/?bucket=${b}&${rq}`;
  const counts = await bucketCounts(ctx.org.id, r, [...new Set<BucketKey>([...CARDS.map((c) => c.key), ...DONUT.map((d) => d.key), ...PIPE])]);
  const announcement = await t("portal.dashboard.announcement");
  const offers = await getSiteContent().then((c) => c.offers).catch(() => DEFAULTS.offers);
  // Onboarding: a new account finishes its profile first; then KYC → admin review → Active.
  const ob = await onboardingState(ctx.org.id);
  // no forced redirect: a new account sees the whole portal; the card below and the KYC reminder show the next step
  const step = STEP_TEXT[ob.step];
  const kycNote = ob.step !== "active" ? (
    <div className="ob-card" role="status">
      <ShieldAlert size={22} aria-hidden />
      <div className="grow">
        <b>{step.title}</b>
        <p>{ob.step === "profile" ? "Add your business name and address to start booking shipments. Then approve KYC for the best rates."
          : ob.step === "kyc" ? "You can book shipments now at standard rates. Upload your KYC documents and get the best (bulk) rates once Vishwaship approves them."
          : ob.step === "review" ? "Your KYC is under review. The best rates apply as soon as it is approved — keep shipping meanwhile."
          : <>Admin asked for changes{ob.reasons.length ? <>: <b>{ob.reasons.join(" · ")}</b></> : null}. Resubmit KYC to get the best rates.</>}</p>
      </div>
      {step.action && <Link className="btn btn-orange" href={step.action.href}>{step.action.label}</Link>}
    </div>
  ) : null;
  return (
    <>
      {/* phone: search, then wallet + notification credits */}
      {(sp.password === "changed" || sp.google === "linked") && <p className="note small mb12" role="status">{sp.password === "changed" ? "Your password has been changed. Other devices were signed out." : "Your Google account is now linked — next time you can use Continue with Google."}</p>}
      <div className="dash-m">
        {kycNote /* activation step first, so cards → Analytics stay together */}
        <DashSearch />
        <div className="dash-m-cards">
          <Link href="/portal/billing/passbook/" className="dm-card"><IcoWallet size={56} /><b>{formatINR(ctx.walletAvailable)}</b><span>Wallet Balance</span></Link>
          <Link href="/portal/billing/notification-credits/" className="dm-card"><IcoCoin size={56} /><b>{ctx.credits.toLocaleString("en-IN")}</b><span>Notification Credits</span></Link>
        </div>
      </div>
      {hasStore && <div className="dash-m"><ProcessSummaryCard orgId={ctx.org.id} /></div>}
      {/* desktop only — on phones Analytics follows the balance cards directly (owner request 2026-11-19) */}
      <div className="dash-desk">
        {announcement && <p className="note small mb12">{announcement}</p>}
        <div className="mb12"><OfferStrip offers={offers} where="dashboard" variant="compact" /></div>
        {kycNote}
      </div>
      <div className="row between wrap mb12 dash-desk" style={{ gap: 12 }}>
        <nav className="seg-tabs" aria-label="Dashboard view">
          <Link href={`/portal/?${rq}`} className={tab === "analytics" ? "on" : ""} aria-current={tab === "analytics" ? "page" : undefined}>Analytics</Link>
          <Link href={`/portal/?tab=status&${rq}`} className={tab === "status" ? "on" : ""} aria-current={tab === "status" ? "page" : undefined}>Order Status</Link>
        </nav>
        <Suspense fallback={<span className="small muted">{r.fromStr} to {r.toStr}</span>}><DateRangePicker from={r.fromStr} to={r.toStr} /></Suspense>
      </div>

      {tab === "analytics" ? <Analytics orgId={ctx.org.id} hasStore={hasStore} walletId={ctx.walletId} counts={counts} href={href} r={r} rq={rq} /> : <OrderStatus orgId={ctx.org.id} counts={counts} stage={isBucket(sp.stage) ? sp.stage : "new"} r={r} rq={rq} />}
    </>
  );
}

async function Analytics({ orgId, hasStore, walletId, counts, href, r, rq }: { orgId: string; hasStore: boolean; walletId: string | null; counts: Record<BucketKey, number>; href: (b: BucketKey) => string; r: ReturnType<typeof dashRange>; rq: string }) {
  const db = await getDb();
  const txns = walletId ? await db.select().from(schema.ledgerEntries).where(and(eq(schema.ledgerEntries.walletId, walletId), gte(schema.ledgerEntries.createdAt, r.from), lte(schema.ledgerEntries.createdAt, r.to))).orderBy(desc(schema.ledgerEntries.createdAt)).limit(7) : [];
  const recent = await listOrders(orgId, { from: r.fromStr, to: r.toStr, pageSize: 8 });
  const donutTotal = DONUT.reduce((t, d) => t + counts[d.key], 0);
  // donut geometry
  const R = 70, C = 2 * Math.PI * R;
  let offset = 0;
  const segs = DONUT.map((d) => { const len = donutTotal ? (counts[d.key] / donutTotal) * C : 0; const s = { ...d, len, offset }; offset += len; return s; });
  return (
    <>
      <h2 className="dm-h dm-only">Analytics</h2>
      <section className="dash-cards mb16" aria-label="Order summary">
        {CARDS.map((c) => (
          <Link key={c.key} href={href(c.key)} className={`dcard t-${c.tone}`} aria-label={`${BUCKETS[c.key].label}: ${counts[c.key]} — open list`}>
            {(() => { const I = DASH_ICONS[c.key as keyof typeof DASH_ICONS]; return I ? <I size={56} /> : <c.icon size={34} strokeWidth={1.6} aria-hidden />; })()}
            <span className="dl">{BUCKETS[c.key].label}</span>
            <span className="dn">{counts[c.key].toLocaleString("en-IN")}</span>
          </Link>
        ))}
      </section>

      {/* desktop: store dispatch work below the analytics icons, above Wallet Transactions (owner request) */}
      {hasStore && <div className="dash-desk"><ProcessSummaryCard orgId={orgId} /></div>}
      <div className="dash-panels mb16 dash-desk">
        <section className="card p0" aria-labelledby="wt-h">
          <div className="row between card-h"><h2 id="wt-h" className="b" style={{ fontSize: 16, margin: 0 }}>Wallet Transactions</h2><Link className="btn btn-sm btn-soft" href={`/portal/billing/passbook/?${rq}`}>View All</Link></div>
          {txns.length === 0 ? <div className="empty" style={{ minHeight: 260, justifyContent: "center" }}><p className="muted small">No wallet transactions in this period.</p></div> : (
            <ul className="plain-list">{txns.map((x) => (
              <li key={x.id}><Link href={`/portal/billing/passbook/?${rq}`} className="row between" style={{ gap: 10 }}>
                <span style={{ minWidth: 0 }}><span className="small b" style={{ display: "block" }}>{x.memo ?? x.kind.replace(/_/g, " ")}</span><span className="tiny muted">{x.createdAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}{x.refId ? ` · ${x.refId}` : ""}</span></span>
                <span style={{ textAlign: "right" }}><span className={`b small ${x.amountPaise > 0 ? "t-credit" : x.amountPaise < 0 ? "t-debit" : ""}`} style={{ display: "block" }}>{x.amountPaise === 0 ? formatINR(Math.abs(x.holdDeltaPaise)) : `${x.amountPaise > 0 ? "+" : "−"}${formatINR(Math.abs(x.amountPaise))}`}</span><span className="tiny muted">{x.amountPaise === 0 ? (x.holdDeltaPaise > 0 ? "On hold" : "Released") : "Posted"}</span></span>
              </Link></li>
            ))}</ul>
          )}
        </section>
        <section className="card p0" aria-labelledby="sh-h">
          <div className="card-h"><h2 id="sh-h" className="b" style={{ fontSize: 16, margin: 0 }}>Shipment</h2></div>
          {donutTotal === 0 ? <div className="empty" style={{ minHeight: 260, justifyContent: "center" }}><p className="muted small">No delivered, RTO or NDR shipments in this period.</p></div> : (
            <div className="donut-wrap">
              <svg viewBox="0 0 200 200" width="220" height="220" role="img" aria-label={`Shipment outcomes: ${DONUT.map((d) => `${BUCKETS[d.key].label} ${counts[d.key]}`).join(", ")}`}>
                <g transform="rotate(-90 100 100)">
                  {segs.filter((s) => s.len > 0).map((s) => (
                    <a key={s.key} href={href(s.key)} aria-label={`${BUCKETS[s.key].label}: ${counts[s.key]}`}>
                      <circle cx="100" cy="100" r={R} fill="none" stroke={s.color} strokeWidth="34" strokeDasharray={`${s.len} ${C - s.len}`} strokeDashoffset={-s.offset} className="donut-seg"><title>{`${BUCKETS[s.key].label}: ${counts[s.key]} (${((counts[s.key] / donutTotal) * 100).toFixed(1)}%)`}</title></circle>
                    </a>
                  ))}
                </g>
                <text x="100" y="96" textAnchor="middle" className="donut-n">{donutTotal}</text>
                <text x="100" y="116" textAnchor="middle" className="donut-l">shipments</text>
              </svg>
              <ul className="donut-legend" aria-label="Legend">
                {DONUT.map((d) => <li key={d.key}><Link href={href(d.key)}><i style={{ background: d.color }} />{BUCKETS[d.key].label} <b>{counts[d.key]}</b> <span className="tiny muted">{((counts[d.key] / donutTotal) * 100).toFixed(1)}%</span></Link></li>)}
              </ul>
            </div>
          )}
        </section>
      </div>

      <section className="card p0" aria-labelledby="ro-h">
        <div className="row between card-h"><h2 id="ro-h" className="b" style={{ fontSize: 16, margin: 0 }}>Recent Orders</h2><Link className="btn btn-sm btn-soft" href={`/portal/orders/?bucket=all&${rq}`}>View All Orders</Link></div>
        {recent.rows.length === 0 ? <div className="empty"><p className="muted small">No orders in this period.</p><Link className="btn btn-orange btn-sm" href="/portal/orders/new/">Create Order</Link></div> : (
          <>
          <ul className="ro-cards" aria-label="Recent orders">
            {recent.rows.map((o) => {
              const c = o.consignee as { name: string; city: string };
              return (
                <li key={o.orderId}><Link href={`/portal/orders/${o.orderId}/`}>
                  <span className="ro-l"><b>{o.orderNumber}</b><span className="tiny muted">{c.name}{c.city ? ` · ${c.city}` : ""}{o.awb ? ` · AWB ${o.awb}` : ""}</span></span>
                  <span className="ro-r">{o.status ? <StatusChip status={o.status} /> : <span className="chip c-draft">{o.orderStatus.replace(/_/g, " ")}</span>}<span className="tiny">{o.paymentType === "cod" ? `COD ${formatINR(o.codAmount)}` : o.paymentType === "fod" ? "FOD" : "Prepaid"} · {dt(o.createdAt)}</span></span>
                </Link></li>
              );
            })}
          </ul>
          <div className="tbl-wrap ro-table"><table className="tbl">
            <thead><tr><th>Order ID</th><th>AWB / LR</th><th>Recipient</th><th>Courier</th><th>Payment</th><th>Status</th><th>Order date</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>{recent.rows.map((o) => {
              const c = o.consignee as { name: string; city: string };
              const logo = o.carrierCode ? carrierLogo(o.carrierCode) : null;
              return (
                <tr key={o.orderId}>
                  <td><Link className="b link-navy" href={`/portal/orders/${o.orderId}/`}>{o.orderNumber}</Link></td>
                  <td className="small"><span className="id-row">{o.awb ? <><AwbLink value={o.awb} href={portalTrackHref(o.awb)} /><CopyBtn value={o.awb} label="AWB" /></> : <span className="mono">{o.lr ?? "—"}</span>}</span>{o.lr && o.lr !== o.awb && o.awb ? <div className="tiny muted">LR {o.lr}</div> : null}</td>
                  <td className="small">{c.name}<div className="tiny muted">{c.city}</div></td>
                  <td>{logo ? <img className="clogo-sm" src={logo} alt={o.carrierName ?? ""} title={o.carrierName ?? ""} /> : <span className="small muted">{o.carrierName ?? "—"}</span>}</td>
                  <td><span className={`chip ${o.paymentType === "cod" ? "c-cod" : "c-prepaid"}`}>{o.paymentType === "cod" ? `COD ${formatINR(o.codAmount)}` : o.paymentType === "fod" ? "FOD" : "Prepaid"}</span></td>
                  <td>{o.status ? <StatusChip status={o.status} /> : <span className="chip c-draft">{o.orderStatus.replace(/_/g, " ")}</span>}</td>
                  <td className="small">{dt(o.createdAt)}</td>
                  <td><span className="row" style={{ gap: 4 }}>
                    {o.awb && <Link className="btn btn-sm btn-outline" href={`/portal/track/?q=${encodeURIComponent(o.awb)}`} title="Track"><Truck size={14} /></Link>}
                    {o.shipmentId && o.awb && <a className="btn btn-sm btn-outline" href={`/api/portal/shipments/${o.shipmentId}/label`} title="Download label"><Download size={14} /></a>}
                  </span></td>
                </tr>
              );
            })}</tbody>
          </table></div>
          </>
        )}
      </section>
    </>
  );
}

async function OrderStatus({ orgId, counts, stage, r, rq }: { orgId: string; counts: Record<BucketKey, number>; stage: BucketKey; r: ReturnType<typeof dashRange>; rq: string }) {
  const list = await listOrders(orgId, { bucket: stage, from: r.fromStr, to: r.toStr, pageSize: 20 });
  return (
    <>
      <nav className="pipeline mb16" aria-label="Order pipeline">
        {PIPE.map((k, i) => (
          <Link key={k} href={`/portal/?tab=status&stage=${k}&${rq}`} className={stage === k ? "on" : ""} aria-current={stage === k ? "true" : undefined}>
            <span className="pn">{counts[k]}</span><span className="pl">{BUCKETS[k].label}</span>{i < PIPE.length - 1 && <span className="parrow" aria-hidden>›</span>}
          </Link>
        ))}
      </nav>
      <section className="card p0">
        <div className="row between card-h"><h2 className="b" style={{ fontSize: 16, margin: 0 }}>{BUCKETS[stage].label} <span className="small muted">· {BUCKETS[stage].desc}</span></h2><Link className="btn btn-sm btn-soft" href={`/portal/orders/?bucket=${stage}&${rq}`}>Open in Orders</Link></div>
        {list.rows.length === 0 ? <div className="empty"><p className="muted small">No orders at this stage in the selected dates.</p></div> : (
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Order ID</th><th>AWB / LR</th><th>Recipient</th><th>Courier</th><th>Status</th><th>Date</th></tr></thead>
            <tbody>{list.rows.map((o) => <tr key={o.orderId}><td><Link className="b link-navy" href={`/portal/orders/${o.orderId}/`}>{o.orderNumber}</Link></td><td className="mono small">{o.awb ?? o.lr ?? "—"}</td><td className="small">{(o.consignee as { name: string }).name}</td><td className="small">{o.carrierName ?? "—"}</td><td>{o.status ? <StatusChip status={o.status} /> : <span className="chip c-draft">{o.orderStatus.replace(/_/g, " ")}</span>}</td><td className="small">{dt(o.createdAt)}</td></tr>)}</tbody>
          </table></div>
        )}
        {list.total > list.rows.length && <p className="small" style={{ padding: "8px 16px" }}><Link className="link" href={`/portal/orders/?bucket=${stage}&${rq}`}>View all {list.total} →</Link></p>}
      </section>
    </>
  );
}
