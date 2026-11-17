import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { desc, eq } from "drizzle-orm";
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

const TABS = ["overview", "shipments", "kyc", "pricing", "wallet", "features", "notifications"] as const;

export default async function CustomerDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; msg?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const tab = TABS.find((t) => t === sp.tab) ?? "overview";
  const s = await requireStaff("customers.read");
  const db = await getDb();
  const [org] = await db.select().from(schema.orgs).where(eq(schema.orgs.id, id));
  if (!org) notFound();
  const [wallet] = await db.select().from(schema.wallets).where(eq(schema.wallets.orgId, id));
  const settings = await loadMarkupSettings("shipmozo");
  const ov = settings.overrides.filter((o) => o.orgId === id && !o.clearedAt).sort((a, b) => b.version - a.version)[0];

  async function saveOverride(fd: FormData) {
    "use server";
    const st = await requireStaff("pricing.write");
    const mode = String(fd.get("mode"));
    if (mode === "global") await clearOverride("shipmozo", id, st.userId);
    else {
      const pct = Number(fd.get("pct"));
      if (!(pct >= 0 && pct <= 500)) redirect(`/admin/customers/${id}/?tab=pricing&msg=range`);
      await setMarkup("shipmozo", id, Math.round(pct * 100), st.userId);
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

  const shipments = tab === "shipments" ? await db.select().from(schema.shipments).where(eq(schema.shipments.orgId, id)).orderBy(desc(schema.shipments.createdAt)).limit(50) : [];
  const ledger = tab === "wallet" && wallet ? await db.select().from(schema.ledgerEntries).where(eq(schema.ledgerEntries.walletId, wallet.id)).orderBy(desc(schema.ledgerEntries.createdAt)).limit(30) : [];
  const warehouses = tab === "overview" ? await db.select().from(schema.warehouses).where(eq(schema.warehouses.orgId, id)) : [];
  return (
    <>
      <div className="page-h">
        <div><Link className="small link-navy" href="/admin/customers/">← Customers</Link><h1>{org.businessName}</h1><div className="tiny muted mono">{org.id}</div></div>
        <div className="actions">
          <span className={`chip ${org.status === "active" ? "c-active" : "c-cancelled"}`}>{org.status}</span>
          {can(s.role, "customers.write") && <form action={setStatus}><input type="hidden" name="status" value={org.status === "active" ? "suspended" : "active"} /><button className="btn btn-sm btn-outline">{org.status === "active" ? "Suspend" : "Activate"}</button></form>}
          {can(s.role, "customers.impersonate") && <form action={loginAsCustomer}><input type="hidden" name="orgId" value={org.id} /><button className="btn btn-sm btn-orange"><LogIn size={14} /> Login as customer</button></form>}
        </div>
      </div>
      <Link href={`/admin/customers/${id}/?tab=wallet`} className="stat bl-orange stat-link mb16" style={{ display: "block", maxWidth: 360 }}>
        <div className="t"><Wallet size={14} /> Wallet balance</div>
        <div className="v">{formatINR(wallet ? wallet.postedPaise - wallet.reservedPaise : 0)}</div>
        <div className="s">{wallet && wallet.reservedPaise > 0 ? `${formatINR(wallet.reservedPaise)} on hold for bookings · ` : ""}View passbook</div>
      </Link>
      <nav className="tabs">{TABS.map((t) => <Link key={t} href={`/admin/customers/${id}/?tab=${t}`} className={tab === t ? "on" : ""}>{t[0].toUpperCase() + t.slice(1)}</Link>)}</nav>
      {sp.msg && <p className={sp.msg === "saved" || sp.msg === "adjusted" || sp.msg.includes(" ") ? "small t-credit mb12" : "small err mb12"} role="status">{{ nouser: "This customer has no active login user to open.", saved: "Pricing saved.", adjusted: "Wallet adjusted.", range: "Enter 0–500%.", invalid: "Enter an amount and a reason (5+ chars).", insufficient: "Insufficient balance for that debit." }[sp.msg] ?? ""}</p>}

      {tab === "overview" && (
        <div className="grid2" style={{ gap: 12 }}>
          <section className="card" style={{ padding: 16 }}><dl className="kv-list"><dt>GSTIN</dt><dd>{org.gstin ?? "—"}</dd><dt>KYC</dt><dd>{org.kycStatus}</dd><dt>Volume</dt><dd>{org.expectedMonthlyVolume ?? "—"}</dd><dt>Wallet</dt><dd>{formatINR(wallet ? wallet.postedPaise - wallet.reservedPaise : 0)}</dd><dt>Shipmozo markup</dt><dd>{(ov?.bps ?? settings.global.bps) / 100}% ({ov ? "override" : "global"})</dd></dl></section>
          <section className="card" style={{ padding: 16 }}><b className="small">Warehouses</b>{warehouses.map((w) => <p key={w.id} className="small" style={{ margin: "6px 0" }}>{w.label} · {w.city} {w.pincode} · {w.mobileVerifiedAt ? "mobile verified" : "mobile NOT verified"}</p>)}</section>
        </div>
      )}
      {tab === "shipments" && (
        <div className="card p0 tbl-wrap"><table className="tbl"><thead><tr><th>AWB</th><th>Carrier</th><th>Status</th><th className="r">Selling</th><th>Date</th></tr></thead>
          <tbody>{shipments.map((x) => <tr key={x.id}><td><Link className="link-navy mono small" href={`/admin/shipments/${x.id}/`}>{x.awb}</Link></td><td className="small">{x.carrierName}</td><td><StatusChip status={x.status} /></td><td className="r">{formatINR(x.sellPaise)}</td><td className="small">{x.createdAt.toLocaleDateString("en-IN")}</td></tr>)}</tbody></table></div>
      )}
      {tab === "kyc" && <p className="small"><Link className="link" href={`/admin/kyc/?org=${id}`}>Open KYC review for this customer →</Link></p>}
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
      {tab === "wallet" && (
        <>
          <div className="stats3 stats mb12"><div className="stat bl-orange"><div className="t">Posted</div><div className="v">{formatINR(wallet?.postedPaise ?? 0)}</div></div><div className="stat bl-blue"><div className="t">On hold</div><div className="v">{formatINR(wallet?.reservedPaise ?? 0)}</div></div></div>
          {can(s.role, "finance.adjust") && (
            <form action={adjust} className="card row wrap mb12" style={{ padding: 14, gap: 8, alignItems: "end" }}>
              <div className="field"><label htmlFor="dir">Type</label><select id="dir" name="dir" className="select"><option value="credit">Credit</option><option value="debit">Debit</option></select></div>
              <div className="field"><label htmlFor="amt">Amount (₹)</label><input id="amt" name="amount" type="number" step="0.01" min="0.01" className="input" required /></div>
              <div className="field" style={{ flex: 1, minWidth: 200 }}><label htmlFor="rsn">Reason (audited)</label><input id="rsn" name="reason" className="input" required minLength={5} /></div>
              <button className="btn btn-navy">Post adjustment</button>
            </form>
          )}
          <div className="card p0 tbl-wrap"><table className="tbl"><thead><tr><th>Date</th><th>Kind</th><th>Memo</th><th className="r">Amount</th><th className="r">Balance</th></tr></thead>
            <tbody>{ledger.map((l) => <tr key={l.id}><td className="small">{l.createdAt.toLocaleString("en-IN")}</td><td className="small">{l.kind}</td><td className="small">{l.memo}</td><td className="r">{formatINR(l.amountPaise)}</td><td className="r">{formatINR(l.balanceAfterPaise)}</td></tr>)}</tbody></table></div>
        </>
      )}
      {tab === "features" && <FeaturesTab orgId={id} write={can(s.role, "modules.manage")} />}
      {tab === "notifications" && <p className="small muted">Customer channel settings and delivery logs: <Link className="link" href={`/admin/notifications/?org=${id}`}>open in Notifications</Link>.</p>}
    </>
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
