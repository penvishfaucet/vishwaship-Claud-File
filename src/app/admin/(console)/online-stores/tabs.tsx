import { and, desc, eq, inArray } from "drizzle-orm";
import { budgetText } from "@/lib/store-plan";
import { THEMES, rupees } from "@/lib/store-themes";
import { decideStoreDeposit, saveStoreBillingSettings, saveStorePlan } from "@/server/admin/store-actions";
import { getDb, schema } from "@/server/db/client";
import { CHANGE_KINDS, type ChangeKind, billingConfig, listPlans } from "@/server/store/billing";

const day = (d: Date | null) => (d ? d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" }) : "—");

/** Admin → Online Stores → Plans & settings. */
export async function BillingSettings({ canWrite }: { canWrite: boolean }) {
  const [cfg, plans] = await Promise.all([billingConfig(), listPlans(false)]);
  const dis = !canWrite;
  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 980 }}>
      <div className="card p0">
        <div className="card-h"><b>Store plans</b><span className="small muted"> · price includes GST, paid from the merchant&apos;s wallet</span></div>
        {plans.map((p) => <PlanRow key={p.id} p={p} dis={dis} canWrite={canWrite} />)}
        {canWrite && <PlanRow p={null} dis={false} canWrite nextSort={plans.length + 1} />}
        <p className="tiny muted" style={{ padding: "0 12px 10px" }}>Changing a price affects new purchases only. Merchants who already paid keep their period.</p>
      </div>

      <form action={saveStoreBillingSettings} className="card" style={{ padding: 16, display: "grid", gap: 12 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>Trial, deposit & terms</h3>
        <div className="row wrap" style={{ gap: 12 }}>
          <div className="field"><label htmlFor="td">Free trial (days)</label><input id="td" name="trialDays" className="input" inputMode="numeric" defaultValue={cfg.trialDays} style={{ width: 120 }} disabled={dis} /><span className="small muted">For new stores</span></div>
          <div className="field"><label htmlFor="dp">Managed Ads deposit (₹)</label><input id="dp" name="depositRupees" className="input" inputMode="numeric" defaultValue={cfg.depositPaise / 100} style={{ width: 140 }} disabled={dis} /><span className="small muted">For new deposits</span></div>
          <div className="field"><label htmlFor="rd">Refund within (working days)</label><input id="rd" name="refundDays" className="input" inputMode="numeric" defaultValue={cfg.refundDays} style={{ width: 120 }} disabled={dis} /></div>
        </div>
        <div className="field"><label htmlFor="tm">Managed Meta Ads terms (version {cfg.termsVersion})</label>
          <textarea id="tm" name="terms" className="input" rows={9} defaultValue={cfg.terms} disabled={dis} />
          <span className="small muted">Changing the text creates a new version. Merchants must accept it again before new deposits or service starts.</span></div>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}><legend className="small" style={{ fontWeight: 600, marginBottom: 6 }}>Themes merchants can pick</legend>
          <div className="row wrap" style={{ gap: 14 }}>{THEMES.map((t) => (
            <label key={t.key} className="row small" style={{ gap: 6 }}>
              <input type="checkbox" name="enabledThemes" value={t.key} defaultChecked={!cfg.disabledThemes.includes(t.key)} disabled={dis} /> {t.name}
            </label>
          ))}</div>
          <span className="small muted">A store already using a switched-off theme keeps it. Custom designs are set per store.</span>
        </fieldset>
        {canWrite && <div><button className="btn btn-orange">Save settings</button></div>}
      </form>
    </div>
  );
}

/** Admin → Online Stores → Deposits. */
export async function DepositsTab({ status, canDecide }: { status?: string; canDecide: boolean }) {
  const db = await getDb();
  const st = ["held", "refund_requested", "refunded", "forfeited"].includes(status ?? "") ? status! : null;
  const rows = await db.select({ d: schema.storeDeposits, store: schema.stores.name, storeId: schema.stores.id, org: schema.orgs.businessName })
    .from(schema.storeDeposits).innerJoin(schema.stores, eq(schema.stores.id, schema.storeDeposits.storeId)).innerJoin(schema.orgs, eq(schema.orgs.id, schema.storeDeposits.orgId))
    .where(st ? eq(schema.storeDeposits.status, st) : undefined).orderBy(desc(schema.storeDeposits.createdAt)).limit(300);
  const held = rows.filter((r) => r.d.status === "held" || r.d.status === "refund_requested").reduce((n, r) => n + r.d.amountPaise, 0);
  return (
    <>
      <form className="card mb12 row wrap" style={{ padding: 12, gap: 8, alignItems: "flex-end" }}>
        <input type="hidden" name="tab" value="deposits" />
        <div className="field"><label htmlFor="ds">Status</label><select id="ds" name="status" className="input select" defaultValue={st ?? ""}>
          <option value="">All</option><option value="refund_requested">Refund requested</option><option value="held">Held</option><option value="refunded">Refunded</option><option value="forfeited">Not refunded</option></select></div>
        <button className="btn btn-outline">Filter</button>
        {!st && <span className="small muted" style={{ marginLeft: "auto" }}>Currently held: <b>{rupees(held)}</b></span>}
      </form>
      {rows.length === 0 ? <div className="card empty"><p className="muted">No deposits.</p></div> : (
        <div className="card p0 tbl-wrap"><table className="tbl"><thead><tr><th>Receipt</th><th>Store</th><th>Amount</th><th>Paid</th><th>Status</th><th>Refund</th></tr></thead>
          <tbody>{rows.map(({ d, store, storeId, org }) => (
            <tr key={d.id}>
              <td className="small mono">{d.receiptNumber}</td>
              <td className="small"><a className="link-navy" href={`/admin/online-stores/${storeId}/`}>{store}</a><div className="tiny muted">{org}</div></td>
              <td className="small">{rupees(d.amountPaise)}</td><td className="small">{day(d.createdAt)}</td>
              <td className="small"><span className={`chip ${d.status === "refund_requested" ? "c-draft" : d.status === "held" ? "c-active" : d.status === "refunded" ? "c-delivered" : "c-failed"}`}>{d.status.replace("_", " ")}</span>
                {d.refundReason && <div className="tiny muted" style={{ maxWidth: 240 }}>Reason: {d.refundReason}</div>}</td>
              <td className="small">{d.status === "refund_requested" && canDecide ? <RefundDecision depositId={d.id} storeId={storeId} amountPaise={d.amountPaise} from="deposits" />
                : d.decidedAt ? <>{d.status === "refunded" ? rupees(d.refundPaise ?? 0) : d.status === "forfeited" ? "₹0" : "Rejected"} · {day(d.decidedAt)}{d.decisionNote && <div className="tiny muted">{d.decisionNote}</div>}</> : "—"}</td>
            </tr>
          ))}</tbody></table></div>
      )}
    </>
  );
}

export function RefundDecision({ depositId, storeId, amountPaise, from }: { depositId: string; storeId: string; amountPaise: number; from: "deposits" | "store" }) {
  return (
    <div style={{ display: "grid", gap: 6, minWidth: 260 }}>
      <form action={decideStoreDeposit} style={{ display: "grid", gap: 6 }}>
        <input type="hidden" name="depositId" value={depositId} /><input type="hidden" name="storeId" value={storeId} /><input type="hidden" name="from" value={from} /><input type="hidden" name="approve" value="1" />
        <div className="row" style={{ gap: 6 }}><input name="refundRupees" className="input" inputMode="decimal" defaultValue={amountPaise / 100} aria-label="Refund amount in rupees" style={{ width: 110, height: 30 }} />
          <button className="btn btn-sm btn-orange">Approve refund</button></div>
        <input name="note" className="input" placeholder="Note (required if less than full)" aria-label="Refund note" style={{ height: 30, fontSize: 12 }} />
      </form>
      <form action={decideStoreDeposit} className="row" style={{ gap: 6 }}>
        <input type="hidden" name="depositId" value={depositId} /><input type="hidden" name="storeId" value={storeId} /><input type="hidden" name="from" value={from} /><input type="hidden" name="approve" value="0" />
        <input name="note" className="input" placeholder="Why not (merchant sees this)" aria-label="Rejection reason" style={{ height: 30, fontSize: 12 }} required minLength={5} />
        <button className="btn btn-sm btn-outline">Reject</button>
      </form>
    </div>
  );
}

/** Admin → Online Stores → Managed Ads. */
export async function AdsTab({ status }: { status?: string }) {
  const db = await getDb();
  const st = ["onboarding", "active", "paused", "ended"].includes(status ?? "") ? status! : null;
  const rows = await db.select({ m: schema.storeManagedAds, store: schema.stores, org: schema.orgs.businessName })
    .from(schema.storeManagedAds).innerJoin(schema.stores, eq(schema.stores.id, schema.storeManagedAds.storeId)).innerJoin(schema.orgs, eq(schema.orgs.id, schema.stores.orgId))
    .where(st ? eq(schema.storeManagedAds.status, st) : undefined).orderBy(desc(schema.storeManagedAds.updatedAt)).limit(300);
  const open = await db.select().from(schema.storeAdChanges).where(inArray(schema.storeAdChanges.status, ["pending", "approved"])).orderBy(desc(schema.storeAdChanges.createdAt)).limit(300);
  const storeIds = [...new Set(open.map((c) => c.storeId))];
  const names = storeIds.length ? new Map((await db.select({ id: schema.stores.id, name: schema.stores.name }).from(schema.stores).where(inArray(schema.stores.id, storeIds))).map((s) => [s.id, s.name])) : new Map<string, string>();
  const staff = await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(and(eq(schema.users.kind, "staff")));
  const staffName = new Map(staff.map((u) => [u.id, u.name]));
  return (
    <>
      <div className="card p0 mb12">
        <div className="card-h"><b>Open campaign changes</b><span className="small muted"> · approved ones need setting up in Meta Ads Manager</span></div>
        {open.length === 0 ? <p className="small muted" style={{ padding: 16, margin: 0 }}>Nothing open.</p> : (
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Store</th><th>Change</th><th>Budget</th><th>Status</th><th>Since</th></tr></thead>
            <tbody>{open.map((c) => (
              <tr key={c.id}>
                <td className="small"><a className="link-navy" href={`/admin/online-stores/${c.storeId}/#ads`}>{names.get(c.storeId) ?? c.storeId}</a></td>
                <td className="small">{CHANGE_KINDS[c.kind as ChangeKind] ?? c.kind}: {c.campaignName}</td>
                <td className="small">{budgetText(c) || "—"}</td>
                <td><span className={`chip ${c.status === "approved" ? "c-active" : "c-draft"}`}>{c.status === "approved" ? "approved · set it up" : "waiting for merchant"}</span></td>
                <td className="small">{day(c.decidedAt ?? c.createdAt)}</td>
              </tr>
            ))}</tbody></table></div>
        )}
      </div>
      <form className="card mb12 row wrap" style={{ padding: 12, gap: 8, alignItems: "flex-end" }}>
        <input type="hidden" name="tab" value="ads" />
        <div className="field"><label htmlFor="as">Service status</label><select id="as" name="status" className="input select" defaultValue={st ?? ""}>
          <option value="">All</option><option value="onboarding">Getting ready</option><option value="active">Running</option><option value="paused">Paused</option><option value="ended">Ended</option></select></div>
        <button className="btn btn-outline">Filter</button>
      </form>
      {rows.length === 0 ? <div className="card empty"><p className="muted">No stores have started Managed Meta Ads.</p></div> : (
        <div className="card p0 tbl-wrap"><table className="tbl"><thead><tr><th>Store</th><th>Status</th><th>Terms</th><th>Monthly limit</th><th>Manager</th><th>Updated</th></tr></thead>
          <tbody>{rows.map(({ m, store, org }) => (
            <tr key={m.id}>
              <td className="small"><a className="link-navy" href={`/admin/online-stores/${store.id}/#ads`}><b>{store.name}</b></a><div className="tiny muted">{org}</div></td>
              <td><span className={`chip ${m.status === "active" ? "c-active" : m.status === "ended" ? "c-failed" : "c-draft"}`}>{m.status}</span></td>
              <td className="small">{m.termsAcceptedAt ? `v${m.termsVersion} · ${day(m.termsAcceptedAt)}` : "Not accepted"}</td>
              <td className="small">{m.monthlyCapPaise ? rupees(m.monthlyCapPaise) : "—"}</td>
              <td className="small">{store.assignedStaffId ? staffName.get(store.assignedStaffId) ?? "—" : <span className="red">Not assigned</span>}</td>
              <td className="small">{day(m.updatedAt)}</td>
            </tr>
          ))}</tbody></table></div>
      )}
    </>
  );
}

type Plan = Awaited<ReturnType<typeof listPlans>>[number];
/** One plan (or the "new plan" row) with visible labels, so it reads well on narrow screens too. */
function PlanRow({ p, dis, canWrite, nextSort = 1 }: { p: Plan | null; dis: boolean; canWrite: boolean; nextSort?: number }) {
  const k = p?.id ?? "new";
  return (
    <form action={saveStorePlan} className="row wrap" style={{ gap: 8, padding: "10px 12px", alignItems: "flex-end", borderTop: "1px solid var(--line)", background: p ? undefined : "var(--gray-soft)" }}>
      {p && <input type="hidden" name="id" value={p.id} />}
      <div className="field"><label htmlFor={`pn-${k}`}>{p ? "Plan name" : "New plan name"}</label><input id={`pn-${k}`} name="name" className="input" defaultValue={p?.name} style={{ width: 160 }} disabled={dis} required /></div>
      <div className="field"><label htmlFor={`pi-${k}`}>Billing</label><select id={`pi-${k}`} name="interval" className="input select" defaultValue={p?.interval ?? "month"} style={{ width: 120 }} disabled={dis}><option value="month">Monthly</option><option value="year">Yearly</option></select></div>
      <div className="field"><label htmlFor={`pp-${k}`}>Price ₹ (excl. GST — GST is added)</label><input id={`pp-${k}`} name="priceRupees" className="input" inputMode="decimal" defaultValue={p ? p.pricePaise / 100 : undefined} style={{ width: 120 }} disabled={dis} required /></div>
      <div className="field"><label htmlFor={`ps-${k}`}>Order</label><input id={`ps-${k}`} name="sort" className="input" inputMode="numeric" defaultValue={p?.sort ?? nextSort} style={{ width: 70 }} disabled={dis} /></div>
      <label className="row small" style={{ gap: 4, paddingBottom: 10 }}><input type="checkbox" name="active" value="1" defaultChecked={p?.active ?? true} disabled={dis} /> On sale</label>
      {canWrite && <button className={`btn btn-sm ${p ? "btn-outline" : "btn-orange"}`} style={{ marginBottom: 6 }}>{p ? "Save" : "Add plan"}</button>}
    </form>
  );
}
