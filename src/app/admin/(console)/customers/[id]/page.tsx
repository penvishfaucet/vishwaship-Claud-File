import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { LogIn, Wallet } from "lucide-react";
import { PreviewQuote } from "@/components/admin/PreviewQuote";
import { loginAsCustomer } from "@/server/admin/impersonate";
import { formatINR } from "@/lib/money";
import { StatusChip } from "@/lib/status";
import { audit } from "@/server/audit";
import { can } from "@/server/auth/rbac";
import { requireStaff } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { clearOverride, setMarkup } from "@/server/pricing/rules";
import { loadMarkupSettings } from "@/server/quotes/service";
import { withLedger } from "@/server/ledger/db-store";
import { credit, debit } from "@/server/ledger/wallet";
import { newId } from "@/server/util/ids";
import { MODULES } from "@/lib/modules";
import { FeatureButtons, PlanControls } from "@/components/admin/FeatureControls";
import { resolveFeatures } from "@/server/features";
import { PassbookView } from "@/components/billing/PassbookView";
import { PASSBOOK_TYPES, type PassbookType, passbookHistory } from "@/server/passbook";
import { onboardingState, STEP_TEXT } from "@/server/onboarding";
import { adminOrderRows, parseOrderFilters, tabCounts } from "@/server/orders/view";
import { orderStatusText } from "@/lib/order-view";
import { orgSetting } from "@/server/couriers";

const TABS = ["overview", "shipments", "wallet", "kyc", "pricing", "features", "notifications"] as const;
const TAB_LABEL: Record<(typeof TABS)[number], string> = { overview: "Overview", shipments: "Shipments", wallet: "Wallet & Passbook", kyc: "KYC & Billing", pricing: "Pricing", features: "Features", notifications: "Notifications" };
const KYC_LABEL: Record<string, string> = { not_started: "KYC not started", pending: "KYC under review", approved: "KYC approved", changes_requested: "KYC changes needed", rejected: "KYC rejected" };
const KYC_CHIP: Record<string, string> = { approved: "c-active", pending: "c-pending", changes_requested: "c-awaiting_customer", rejected: "c-failed", not_started: "c-draft" };
const TONE_CHIP: Record<string, string> = { green: "c-delivered", red: "c-ndr", blue: "c-in_transit", orange: "c-out_for_delivery", amber: "c-pending", gray: "c-cancelled" };
const day = (d: Date | null | undefined) => (d ? d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }) : "—");
const ALL_TIME = { from: "2020-01-01" };

export default async function CustomerDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; msg?: string; from?: string; to?: string; type?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const tab = TABS.find((t) => t === sp.tab) ?? "overview";
  const s = await requireStaff("customers.read");
  const db = await getDb();
  const [org] = await db.select().from(schema.orgs).where(eq(schema.orgs.id, id));
  if (!org) notFound();
  const [wallet] = await db.select().from(schema.wallets).where(eq(schema.wallets.orgId, id));
  const settings = await loadMarkupSettings();
  const ov = settings.overrides.filter((o) => o.orgId === id && !o.clearedAt).sort((a, b) => b.version - a.version)[0];

  async function saveOverride(fd: FormData) {
    "use server";
    const st = await requireStaff("pricing.write");
    const mode = String(fd.get("mode"));
    if (mode === "global") await clearOverride("*", id, st.userId);
    else {
      const pct = Number(fd.get("pct"));
      if (!(pct >= 0 && pct <= 500)) redirect(`/admin/customers/${id}/?tab=pricing&msg=range`);
      await setMarkup("*", id, Math.round(pct * 100), st.userId);
    }
    revalidatePath(`/admin/customers/${id}/`);
    redirect(`/admin/customers/${id}/?tab=pricing&msg=saved`);
  }
  async function adjust(fd: FormData) {
    "use server";
    const st = await requireStaff("finance.adjust");
    const amt = Math.round(Number(fd.get("amount")) * 100);
    const reason = String(fd.get("reason") ?? "").trim();
    const dir = String(fd.get("dir"));
    if (!(amt > 0) || reason.length < 5) redirect(`/admin/customers/${id}/?tab=wallet&msg=invalid`);
    const d = await getDb();
    const [w] = await d.select().from(schema.wallets).where(eq(schema.wallets.orgId, id));
    const key = `adj:${newId("adj")}`;
    try {
      await withLedger((store) => dir === "credit"
        ? credit(store, { walletId: w.id, amount: amt, kind: "adjustment_credit", idempotencyKey: key, refType: "staff", refId: st.userId, memo: `Adjustment: ${reason}` })
        : debit(store, { walletId: w.id, amount: amt, kind: "adjustment_debit", idempotencyKey: key, refType: "staff", refId: st.userId, memo: `Adjustment: ${reason}` }));
    } catch { redirect(`/admin/customers/${id}/?tab=wallet&msg=insufficient`); }
    await audit({ actorUserId: st.userId, actorKind: "staff", orgId: id, action: `wallet.${dir}_adjustment`, details: { amountPaise: amt, reason } });
    redirect(`/admin/customers/${id}/?tab=wallet&msg=adjusted`);
  }
  async function setStatus(fd: FormData) {
    "use server";
    const st = await requireStaff("customers.write");
    const status = String(fd.get("status")) === "suspended" ? "suspended" : "active";
    await (await getDb()).update(schema.orgs).set({ status }).where(eq(schema.orgs.id, id));
    await audit({ actorUserId: st.userId, actorKind: "staff", orgId: id, action: `customer.${status}` });
    redirect(`/admin/customers/${id}/`);
  }

  const perms = { docs: can(s.role, "kyc.documents.read"), wallet: can(s.role, "finance.read"), adjust: can(s.role, "finance.adjust"), ship: can(s.role, "shipments.read") };
  const ob = await onboardingState(id);
  const users = await db.select().from(schema.users).where(and(eq(schema.users.orgId, id), eq(schema.users.kind, "customer"))).orderBy(asc(schema.users.createdAt));
  const allF = parseOrderFilters({ ...ALL_TIME, customer: id });
  const sc = await tabCounts(null, { ...allF, tab: "all" });
  const [{ n: cancelled }] = await db.select({ n: count() }).from(schema.shipments).where(and(eq(schema.shipments.orgId, id), eq(schema.shipments.status, "cancelled")));
  const [{ n: shipCount }] = await db.select({ n: count() }).from(schema.shipments).where(eq(schema.shipments.orgId, id));
  const [rc] = await db.select({ n: count(), credited: sql<number>`coalesce(sum(case when ${schema.recharges.status} = 'credited' then ${schema.recharges.amountPaise} else 0 end), 0)::bigint` }).from(schema.recharges).where(eq(schema.recharges.orgId, id));
  const avail = wallet ? wallet.postedPaise - wallet.reservedPaise : 0;
  const shipLink = (extra: Record<string, string> = {}) => `/admin/shipments/?${new URLSearchParams({ customer: id, ...ALL_TIME, ...extra })}`;
  const addr = (org.address ?? {}) as { line1?: string; line2?: string; city?: string; state?: string; pincode?: string };
  return (
    <>
      <div className="page-h cu-head">
        <div><Link className="small link-navy" href="/admin/customers/">← Customers</Link><h1>{org.businessName}</h1>
          <div className="row wrap" style={{ gap: 6, marginTop: 4 }}><span className="tiny muted mono">{org.id}</span><span className={`chip ${org.status === "active" ? "c-active" : "c-cancelled"}`}>{org.status === "active" ? "Active" : "Suspended"}</span><span className={`chip ${KYC_CHIP[org.kycStatus] ?? "c-pending"}`}>{KYC_LABEL[org.kycStatus] ?? org.kycStatus}</span>{ob.step !== "active" && <span className="chip c-pending">Onboarding: {STEP_TEXT[ob.step].title}</span>}</div>
        </div>
        <div className="actions">
          {can(s.role, "customers.write") && <form action={setStatus}><input type="hidden" name="status" value={org.status === "active" ? "suspended" : "active"} /><button className="btn btn-sm btn-outline">{org.status === "active" ? "Suspend" : "Activate"}</button></form>}
          {can(s.role, "customers.impersonate") && <form action={loginAsCustomer}><input type="hidden" name="orgId" value={org.id} /><button className="btn btn-sm btn-orange"><LogIn size={14} /> Login as customer</button></form>}
        </div>
      </div>
      <div className="cu-sum mb12" aria-label="Summary">
        {perms.wallet && <Link className="cu-fig" href={`/admin/customers/${id}/?tab=wallet`}><span><Wallet size={13} aria-hidden /> Wallet balance</span><b>{formatINR(avail)}</b><small>{wallet?.reservedPaise ? `${formatINR(wallet.reservedPaise)} on hold · ` : ""}Passbook →</small></Link>}
        <Link className="cu-fig" href={shipLink()}><span>Shipments</span><b>{Number(shipCount).toLocaleString("en-IN")}</b><small>{sc.all.toLocaleString("en-IN")} orders · all time →</small></Link>
        <Link className="cu-fig" href={shipLink({ tab: "in_transit" })}><span>In transit</span><b>{(sc.in_transit + sc.out_for_delivery).toLocaleString("en-IN")}</b><small>incl. out for delivery</small></Link>
        <Link className="cu-fig" href={shipLink({ tab: "delivered" })}><span>Delivered</span><b>{sc.delivered.toLocaleString("en-IN")}</b><small>&nbsp;</small></Link>
        <Link className="cu-fig" href={shipLink({ tab: "ndr" })}><span>NDR / RTO</span><b>{(sc.ndr + sc.rto_in_transit + sc.rto_delivered).toLocaleString("en-IN")}</b><small>{Number(cancelled)} cancelled</small></Link>
        {perms.wallet && <Link className="cu-fig" href={`/admin/recharges/?org=${id}`}><span>Recharges</span><b>{Number(rc.n).toLocaleString("en-IN")}</b><small>{formatINR(Number(rc.credited))} credited</small></Link>}
      </div>
      <nav className="tabs">{TABS.filter((t) => t !== "wallet" || perms.wallet).map((t) => <Link key={t} href={`/admin/customers/${id}/?tab=${t}`} className={tab === t ? "on" : ""} aria-current={tab === t ? "page" : undefined}>{TAB_LABEL[t]}</Link>)}</nav>
      {sp.msg && <p className={sp.msg === "saved" || sp.msg === "adjusted" || sp.msg.includes(" ") ? "small t-credit mb12" : "small err mb12"} role="status">{{ nouser: "This customer has no active login user to open.", saved: "Pricing saved.", adjusted: "Wallet adjusted.", range: "Enter 0–500%.", invalid: "Enter an amount and a reason (5+ chars).", insufficient: "Insufficient balance for that debit." }[sp.msg] ?? ""}</p>}

      {tab === "overview" && <Overview org={org} addr={addr} users={users} showFull={perms.docs} markup={`${(ov?.bps ?? settings.global.bps) / 100}% (${ov ? "customer override" : "global default"})`} />}
      {tab === "shipments" && <ShipmentsTab orgId={id} />}
      {tab === "wallet" && perms.wallet && (
        <>
          {perms.adjust && (
            <details className="card mb12" style={{ padding: 14 }}>
              <summary className="small b">Post a wallet adjustment</summary>
              <form action={adjust} className="row wrap mt8" style={{ gap: 8, alignItems: "end" }}>
                <div className="field"><label htmlFor="dir">Type</label><select id="dir" name="dir" className="select"><option value="credit">Credit</option><option value="debit">Debit</option></select></div>
                <div className="field"><label htmlFor="amt">Amount (₹)</label><input id="amt" name="amount" type="number" step="0.01" min="0.01" className="input" required /></div>
                <div className="field" style={{ flex: 1, minWidth: 200 }}><label htmlFor="rsn">Reason (audited)</label><input id="rsn" name="reason" className="input" required minLength={5} /></div>
                <button className="btn btn-navy">Post adjustment</button>
              </form>
            </details>
          )}
          <WalletTab orgId={id} sp={sp} balance={{ availablePaise: avail, postedPaise: wallet?.postedPaise ?? 0, reservedPaise: wallet?.reservedPaise ?? 0 }} />
        </>
      )}
      {tab === "kyc" && <KycBilling orgId={id} org={org} showDocs={perms.docs} reasons={ob.reasons} />}
      {tab === "pricing" && (
        <div className="split" style={{ gap: 16, alignItems: "start" }}>
          <section className="card" style={{ padding: 18 }}>
            <h2 className="b" style={{ fontSize: 15, marginTop: 0 }}>Shipmozo markup</h2>
            <p className="small">Effective now: <b>{(ov?.bps ?? settings.global.bps) / 100}%</b> ({ov ? `customer override v${ov.version}` : `global default ${settings.global.bps / 100}%`})</p>
            {can(s.role, "pricing.write") ? (
              <form action={saveOverride} className="col" style={{ gap: 10 }}>
                <label className="check small"><input type="radio" name="mode" value="global" defaultChecked={!ov} /> Use global default ({settings.global.bps / 100}%)</label>
                <label className="check small"><input type="radio" name="mode" value="custom" defaultChecked={!!ov} /> Custom percentage</label>
                <div className="field"><label htmlFor="opct">Custom markup (%)</label><input id="opct" name="pct" type="number" step="0.01" min="0" max="500" className="input" defaultValue={ov ? ov.bps / 100 : ""} style={{ maxWidth: 120 }} /></div>
                <button className="btn btn-orange" style={{ alignSelf: "start" }}>Save</button>
              </form>
            ) : <p className="small muted">You can view but not change pricing.</p>}
          </section>
          <PreviewQuote defaultPct={(ov?.bps ?? settings.global.bps) / 100} />
        </div>
      )}
      {tab === "features" && <FeaturesTab orgId={id} write={can(s.role, "modules.manage")} />}
      {tab === "notifications" && <p className="small muted">Customer channel settings and delivery logs: <Link className="link" href={`/admin/notifications/?org=${id}`}>open in Notifications</Link>.</p>}
    </>
  );
}

type Org = typeof schema.orgs.$inferSelect;
type User = typeof schema.users.$inferSelect;

async function Overview({ org, addr, users, showFull, markup }: { org: Org; addr: { line1?: string; line2?: string; city?: string; state?: string; pincode?: string }; users: User[]; showFull: boolean; markup: string }) {
  const db = await getDb();
  const warehouses = await db.select().from(schema.warehouses).where(eq(schema.warehouses.orgId, org.id));
  const place = (a: { line1?: string | null; line2?: string | null; city?: string | null; state?: string | null; pincode?: string | null }) => (showFull ? [a.line1, a.line2, a.city, a.state, a.pincode] : [a.city, a.state, a.pincode]).filter(Boolean).join(", ") || "—";
  return (
    <div className="cu-grid">
      <section className="card cu-card"><h2>Business</h2>
        <dl className="kv-list">
          <dt>Company</dt><dd>{org.businessName}</dd>
          <dt>GSTIN</dt><dd className="mono">{org.gstin ?? "—"}</dd>
          <dt>Address</dt><dd>{place(addr)}{!showFull && <span className="tiny muted"> (full address: KYC-document access)</span>}</dd>
          <dt>Monthly volume</dt><dd>{org.expectedMonthlyVolume ?? "—"}</dd>
          <dt>Joined</dt><dd>{day(org.createdAt)}</dd>
          <dt>Markup</dt><dd>{markup}</dd>
        </dl>
      </section>
      <section className="card cu-card"><h2>Contacts</h2>
        {users.length === 0 ? <p className="small muted">No login users.</p> : <ul className="plain-list">{users.map((u) => (
          <li key={u.id} className="small" style={{ padding: "4px 0" }}><b>{u.name}</b>{!u.active && <span className="chip c-cancelled" style={{ marginLeft: 6 }}>inactive</span>}
            <div className="tiny muted">{u.email ?? "no email"}{u.emailVerifiedAt ? " ✓" : ""} · {u.mobile ?? "no mobile"}{u.googleSub ? " · Google sign-in" : ""}</div></li>
        ))}</ul>}
      </section>
      <section className="card cu-card cu-wide"><h2>Pickup addresses ({warehouses.length})</h2>
        {warehouses.length === 0 ? <p className="small muted">No pickup addresses yet.</p> : (
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Name</th><th>Address</th><th>Contact</th><th>Mobile check</th></tr></thead>
            <tbody>{warehouses.map((w) => <tr key={w.id}><td className="small b">{w.label}<div className="tiny muted mono">{w.code}</div></td><td className="small">{place(w)}</td><td className="small">{w.contactName}{showFull ? ` · ${w.mobile}` : ""}</td><td><span className={`chip ${w.mobileVerifiedAt ? "c-active" : "c-pending"}`}>{w.mobileVerifiedAt ? "Verified" : "Not verified"}</span></td></tr>)}</tbody></table></div>
        )}
      </section>
    </div>
  );
}

async function ShipmentsTab({ orgId }: { orgId: string }) {
  const f = parseOrderFilters({ ...ALL_TIME, customer: orgId, size: "25" });
  const list = await adminOrderRows(f);
  return (
    <>
      <p className="small mb8">Latest {list.rows.length} of {list.total.toLocaleString("en-IN")} orders · <Link className="link-navy" href={`/admin/shipments/?customer=${orgId}&from=2020-01-01`}>Open in All Shipments (filters, tabs, all pages) →</Link></p>
      <div className="card p0 tbl-wrap"><table className="tbl">
        <thead><tr><th>Order ID</th><th>AWB / LR</th><th>Booking date</th><th>Courier</th><th>Type</th><th>Status</th></tr></thead>
        <tbody>
          {list.rows.length === 0 && <tr><td colSpan={6} className="center small muted">No orders yet.</td></tr>}
          {list.rows.map((r) => { const st = orderStatusText(r); const x = r.shipment; return (
            <tr key={r.id}>
              <td>{x ? <Link className="b link-navy" href={`/admin/shipments/${x.id}/`}>{r.orderNumber}</Link> : <span className="b">{r.orderNumber}</span>}</td>
              <td className="mono small">{x?.awb ? <Link className="id-link" href={`/admin/shipments/${x.id}/#tracking`}>{x.awb}</Link> : "—"}</td>
              <td className="small nowrap">{x ? day(x.bookedAt) : `Not booked · ${day(r.createdAt)}`}</td>
              <td className="small">{x?.carrierName ?? "—"}</td>
              <td className="small">{r.type}</td>
              <td><span className={`chip ${TONE_CHIP[st.tone] ?? "c-pending"}`}>{st.text}</span></td>
            </tr>
          ); })}
        </tbody>
      </table></div>
    </>
  );
}

async function WalletTab({ orgId, sp, balance }: { orgId: string; sp: { from?: string; to?: string; type?: string }; balance: { availablePaise: number; postedPaise: number; reservedPaise: number } }) {
  const d = (v: string | undefined, fb: Date) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : fb.toISOString().slice(0, 10));
  const fromS = d(sp.from, new Date(Date.now() - 180 * 86400_000)), toS = d(sp.to, new Date(Date.now() + 5.5 * 3600_000));
  const type = (PASSBOOK_TYPES.find((t) => t.key === sp.type)?.key ?? "all") as PassbookType | "all";
  const items = await passbookHistory(orgId, { from: new Date(`${fromS}T00:00:00+05:30`), to: new Date(`${toS}T23:59:59.999+05:30`), type });
  return (
    <>
      <form className="card mb12 pb-filter">
        <input type="hidden" name="tab" value="wallet" />
        <div className="field"><label htmlFor="wf">From</label><input id="wf" type="date" name="from" className="input" defaultValue={fromS} /></div>
        <div className="field"><label htmlFor="wt">To</label><input id="wt" type="date" name="to" className="input" defaultValue={toS} /></div>
        <div className="field"><label htmlFor="wty">Transaction type</label><select id="wty" name="type" className="select" defaultValue={type}>{PASSBOOK_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select></div>
        <button className="btn btn-navy">Apply</button>
      </form>
      <PassbookView items={items} balance={balance} links={{ order: (_id, n) => `/admin/shipments/?customer=${orgId}&from=2020-01-01&q=${encodeURIComponent(n)}`, recharge: (rid) => `/admin/recharges/?id=${rid}` }} />
    </>
  );
}

const DOC_LABEL: Record<string, string> = { aadhaar: "Aadhaar", pan: "PAN", cancelled_cheque: "Cancelled cheque", gst_certificate: "GST certificate" };
async function KycBilling({ orgId, org, showDocs, reasons }: { orgId: string; org: Org; showDocs: boolean; reasons: string[] }) {
  const db = await getDb();
  const docs = await db.select({ id: schema.kycDocuments.id, docType: schema.kycDocuments.docType, status: schema.kycDocuments.status, masked: schema.kycDocuments.maskedNumber, reason: schema.kycDocuments.reviewReason, at: schema.kycDocuments.createdAt, reviewedAt: schema.kycDocuments.reviewedAt })
    .from(schema.kycDocuments).where(eq(schema.kycDocuments.orgId, orgId)).orderBy(desc(schema.kycDocuments.createdAt));
  const inv = (await orgSetting<{ businessName?: string; gstin?: string }>(orgId, "invoice_settings")) ?? {};
  const billing = await db.select().from(schema.billingDocuments).where(eq(schema.billingDocuments.orgId, orgId)).orderBy(desc(schema.billingDocuments.docDate)).limit(20);
  return (
    <div className="cu-grid">
      <section className="card cu-card"><h2>KYC</h2>
        <p className="small" style={{ margin: 0 }}>Status: <span className={`chip ${KYC_CHIP[org.kycStatus] ?? "c-pending"}`}>{KYC_LABEL[org.kycStatus] ?? org.kycStatus}</span></p>
        {reasons.length > 0 && <p className="small t-debit">Changes asked: {reasons.join(" · ")}</p>}
        {showDocs ? (
          docs.length === 0 ? <p className="small muted">No documents uploaded.</p> : <ul className="plain-list">{docs.map((x) => <li key={x.id} className="small row between" style={{ padding: "4px 0", gap: 8 }}><span><b>{DOC_LABEL[x.docType] ?? x.docType}</b>{x.masked ? <span className="mono tiny muted"> {x.masked}</span> : null}<div className="tiny muted">Uploaded {day(x.at)}{x.reviewedAt ? ` · reviewed ${day(x.reviewedAt)}` : ""}{x.reason ? ` · ${x.reason}` : ""}</div></span><span className={`chip ${KYC_CHIP[x.status] ?? "c-pending"}`}>{x.status.replace(/_/g, " ")}</span></li>)}</ul>
        ) : <p className="small muted">{docs.length} document(s). Viewing KYC documents needs KYC-document access.</p>}
        <p className="small" style={{ margin: "8px 0 0" }}><Link className="link" href={`/admin/kyc/?org=${orgId}`}>Open KYC review →</Link></p>
      </section>
      <section className="card cu-card"><h2>Billing &amp; GST</h2>
        <dl className="kv-list">
          <dt>Invoice name</dt><dd>{inv.businessName || org.businessName}</dd>
          <dt>Invoice GSTIN</dt><dd className="mono">{inv.gstin || org.gstin || "—"}</dd>
          <dt>Profile GSTIN</dt><dd className="mono">{org.gstin ?? "—"}</dd>
        </dl>
      </section>
      <section className="card cu-card cu-wide"><h2>Invoices &amp; notes</h2>
        {billing.length === 0 ? <p className="small muted">No invoices, credit or debit notes yet.</p> : (
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Date</th><th>Number</th><th>Type</th><th className="r">Total</th></tr></thead>
            <tbody>{billing.map((b) => <tr key={b.id}><td className="small">{day(b.docDate)}</td><td className="small mono b">{b.number}</td><td className="small">{b.kind.replace(/_/g, " ")}</td><td className="r small b">{formatINR(b.totalPaise)}</td></tr>)}</tbody></table></div>
        )}
        <p className="small" style={{ margin: "8px 0 0" }}><Link className="link" href="/admin/billing-documents/">All invoices &amp; notes →</Link></p>
      </section>
    </div>
  );
}

async function FeaturesTab({ orgId, write }: { orgId: string; write: boolean }) {
  const db = await getDb();
  const f = await resolveFeatures(orgId);
  const plans = await db.select().from(schema.plans).where(eq(schema.plans.active, true));
  const history = await db.select({ s: schema.orgSubscriptions, p: schema.plans }).from(schema.orgSubscriptions).innerJoin(schema.plans, eq(schema.plans.id, schema.orgSubscriptions.planId)).where(eq(schema.orgSubscriptions.orgId, orgId)).orderBy(desc(schema.orgSubscriptions.createdAt)).limit(10);
  const SRC: Record<string, string> = { customer: "Customer override", plan: "From plan", global: "Global setting", default: "Default" };
  return (
    <div className="split" style={{ gap: 16, alignItems: "start" }}>
      <section className="card p0">
        <h2 className="b small card-h" style={{ margin: 0 }}>Effective modules</h2>
        <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Module</th><th>Status</th><th>Why</th>{write && <th>Override</th>}</tr></thead>
          <tbody>{MODULES.map((m) => {
            const e = f.modules[m.key];
            return (
              <tr key={m.key}>
                <td className="small">{m.label}</td>
                <td><span className={`chip ${e.enabled ? "c-active" : "c-draft"}`}>{e.enabled ? "On" : "Off"}</span></td>
                <td className="tiny muted">{SRC[e.source]}</td>
                {write && <td><FeatureButtons orgId={orgId} module={m.key} label={m.label} current={e.source === "customer" ? (e.enabled ? "on" : "off") : "inherit"} /></td>}
              </tr>
            );
          })}</tbody></table></div>
        <p className="tiny muted" style={{ padding: "0 16px 12px" }}>A customer override with WhatsApp notifications “On” also allows both WhatsApp events without a plan.</p>
      </section>
      <section className="card" style={{ padding: 18 }}>
        <h2 className="b" style={{ fontSize: 15, marginTop: 0 }}>Subscription</h2>
        {f.plan ? <p className="small">Active plan: <b>{f.plan.name}</b>{f.subscription?.expiresAt ? ` · expires ${f.subscription.expiresAt.toLocaleDateString("en-IN")}` : " · no expiry"}</p> : <p className="small muted">No active plan.</p>}
        {write && <PlanControls orgId={orgId} currentPlanId={f.plan?.id ?? null} plans={plans.map((p) => ({ id: p.id, label: `${p.name} · ${formatINR(p.pricePaise)}/${p.billingPeriodDays}d` }))} />}
        {write && plans.length === 0 && <p className="tiny muted mt8">Create a plan first in <Link className="link" href="/admin/plans/">Plans &amp; Features</Link>.</p>}
        {history.length > 0 && <ul className="plain-list mt12">{history.map(({ s: h, p }) => <li key={h.id} className="small row between"><span>{p.name} · {h.startsAt.toLocaleDateString("en-IN")}{h.expiresAt ? ` → ${h.expiresAt.toLocaleDateString("en-IN")}` : ""}</span><span className={`chip ${h.status === "active" ? "c-active" : "c-draft"}`}>{h.status}</span></li>)}</ul>}
      </section>
    </div>
  );
}
