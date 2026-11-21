import { CheckCircle2, Circle } from "lucide-react";
import { and, eq } from "drizzle-orm";
import { budgetText, planState } from "@/lib/store-plan";
import { rupees } from "@/lib/store-themes";
import { assignStoreStaff, extendStoreTrial, proposeAdChange, staffAdChangeAction, staffAdsChecklist, staffAdsStatus } from "@/server/admin/store-actions";
import { can, type StaffRole } from "@/server/auth/rbac";
import { getDb, schema } from "@/server/db/client";
import { CHANGE_KINDS, type ChangeKind, NEEDS_APPROVAL, adChanges, adsChecklist, depositHistory, managedAdsRow, planHistory, staffNames } from "@/server/store/billing";
import { RefundDecision } from "../tabs";

type Store = typeof schema.stores.$inferSelect;
const day = (d: Date | null) => (d ? d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" }) : "—");

/** Plan, account manager, deposit and Managed Meta Ads controls on Admin → Online Stores → store. */
export async function StoreBillingAdmin({ s, role }: { s: Store; role: StaffRole }) {
  const db = await getDb();
  const [subs, m, checklist, deps, changes, staff] = await Promise.all([
    planHistory(s.id), managedAdsRow(s.id), adsChecklist(s), depositHistory(s.id), adChanges(s.id),
    db.select({ id: schema.users.id, name: schema.users.name, role: schema.users.staffRole }).from(schema.users).where(and(eq(schema.users.kind, "staff"), eq(schema.users.active, true))).orderBy(schema.users.name),
  ]);
  const names = await staffNames(changes.flatMap((c) => [c.proposedBy, c.decidedBy, c.appliedBy]));
  const st = planState(s);
  const manage = can(role, "modules.manage"), finance = can(role, "finance.adjust"), custWrite = can(role, "customers.write");
  const missing = checklist.filter((i) => !i.ok);
  const status = m?.status ?? null;
  return (
    <>
      <div className="grid2" style={{ alignItems: "start", marginTop: 16 }}>
        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ fontSize: 14, marginBottom: 8 }}>Plan</h3>
          <dl className="kv-list">
            <dt>Now</dt><dd><span className={`chip ${st.state === "active" ? "c-active" : st.state === "trial" ? "c-draft" : "c-failed"}`}>{st.state === "expired" ? "orders paused" : st.state}</span>{st.until && ` ${st.state === "expired" ? "since" : "till"} ${day(st.until)}`}</dd>
            <dt>Trial ends</dt><dd>{day(s.trialEndsAt)}</dd>
            <dt>Paid till</dt><dd>{day(s.paidUntil)}</dd>
          </dl>
          {subs.length > 0 && <table className="tbl" style={{ marginTop: 8 }}><tbody>{subs.slice(0, 6).map((x) => <tr key={x.id}><td className="small mono">{x.receiptNumber}</td><td className="small">{x.planName}</td><td className="small">{rupees(x.amountPaise)}</td><td className="small">{day(x.periodStart)} – {day(x.periodEnd)}</td></tr>)}</tbody></table>}
          {custWrite && (
            <form action={extendStoreTrial} className="row wrap" style={{ gap: 6, marginTop: 12, alignItems: "flex-end" }}>
              <input type="hidden" name="storeId" value={s.id} />
              <div className="field"><label htmlFor="xd">Extend trial (days)</label><input id="xd" name="days" className="input" inputMode="numeric" defaultValue={7} style={{ width: 90 }} /></div>
              <div className="field" style={{ flex: 1, minWidth: 180 }}><label htmlFor="xr">Reason</label><input id="xr" name="reason" className="input" required minLength={5} maxLength={300} /></div>
              <button className="btn btn-outline">Extend</button>
            </form>
          )}
        </div>
        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ fontSize: 14, marginBottom: 8 }}>Account manager</h3>
          {manage ? (
            <form action={assignStoreStaff} className="row" style={{ gap: 6 }}>
              <input type="hidden" name="storeId" value={s.id} />
              <select name="assignee" className="input select" defaultValue={s.assignedStaffId ?? ""} aria-label="Account manager"><option value="">Not assigned</option>{staff.map((u) => <option key={u.id} value={u.id}>{u.name}{u.role ? ` (${u.role})` : ""}</option>)}</select>
              <button className="btn btn-outline">Save</button>
            </form>
          ) : <p className="small">{staff.find((u) => u.id === s.assignedStaffId)?.name ?? "Not assigned"}</p>}
          <p className="tiny muted">The merchant sees the first name on their Managed Meta Ads page.</p>
          <h3 style={{ fontSize: 14, margin: "16px 0 8px" }}>Security deposits</h3>
          {deps.length === 0 ? <p className="small muted">None.</p> : deps.map((d) => (
            <div key={d.id} style={{ borderTop: "1px solid var(--line)", padding: "8px 0" }}>
              <div className="small"><span className="mono">{d.receiptNumber}</span> · {rupees(d.amountPaise)} · {day(d.createdAt)} · <b>{d.status.replace("_", " ")}</b>{d.status === "refunded" && ` ${rupees(d.refundPaise ?? 0)}`}</div>
              {d.refundReason && <div className="tiny muted">Merchant reason: {d.refundReason}</div>}
              {d.decisionNote && <div className="tiny muted">Note: {d.decisionNote}</div>}
              {d.status === "refund_requested" && finance && <div style={{ marginTop: 6 }}><RefundDecision depositId={d.id} storeId={s.id} amountPaise={d.amountPaise} from="store" /></div>}
            </div>
          ))}
        </div>
      </div>

      <div className="card" id="ads" style={{ padding: 16, marginTop: 16 }}>
        <div className="row between wrap" style={{ gap: 8 }}>
          <h3 style={{ fontSize: 14, margin: 0 }}>Managed Meta Ads {status && <span className={`chip ${status === "active" ? "c-active" : status === "ended" ? "c-failed" : "c-draft"}`}>{status}</span>}</h3>
          {manage && status && (
            <div className="row wrap" style={{ gap: 6 }}>
              {(["active", "paused", "ended"] as const).filter((t) => t !== status && !(status === "ended" && t !== "active")).map((t) => (
                <form key={t} action={staffAdsStatus}><input type="hidden" name="storeId" value={s.id} /><input type="hidden" name="to" value={t} />
                  <button className={`btn btn-sm ${t === "active" ? "btn-orange" : "btn-outline"}`} disabled={t === "active" && missing.length > 0} title={t === "active" && missing.length ? `Not ready: ${missing.map((i) => i.label).join("; ")}` : undefined}>{t === "active" ? (status === "onboarding" ? "Start service" : "Restart service") : t === "paused" ? "Pause" : "End service"}</button></form>
              ))}
            </div>
          )}
        </div>
        {!m ? <p className="small muted">The merchant has not opened Managed Meta Ads yet.</p> : (
          <>
            <p className="small muted" style={{ margin: "6px 0 0" }}>Terms {m.termsAcceptedAt ? `v${m.termsVersion} accepted ${day(m.termsAcceptedAt)}` : "not accepted"} · monthly ad spend limit {m.monthlyCapPaise ? rupees(m.monthlyCapPaise) : "—"} (paid by the merchant to Meta)</p>
            <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0", display: "grid", gap: 6, gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))" }}>
              {checklist.map((i) => (
                <li key={i.key} className="row small" style={{ gap: 6 }}>
                  {i.ok ? <CheckCircle2 size={16} color="var(--green)" aria-label="Done" /> : <Circle size={16} color="var(--muted)" aria-label="Not done" />}
                  <span style={{ flex: 1 }}>{i.label}<span className="tiny muted"> · {i.who}</span></span>
                  {manage && i.who !== "auto" && (
                    <form action={staffAdsChecklist}><input type="hidden" name="storeId" value={s.id} /><input type="hidden" name="key" value={i.key} /><input type="hidden" name="done" value={i.ok ? "0" : "1"} />
                      <button className="btn btn-sm btn-outline" title={i.who === "merchant" ? "Normally ticked by the merchant" : undefined}>{i.ok ? "Undo" : i.who === "staff" ? "Confirm" : "Tick"}</button></form>
                  )}
                </li>
              ))}
            </ul>

            {manage && status !== "ended" && (
              <form action={proposeAdChange} className="card" style={{ padding: 12, marginTop: 14, background: "var(--gray-soft)", display: "grid", gap: 8 }}>
                <b className="small">Propose or record a campaign change</b>
                <input type="hidden" name="storeId" value={s.id} />
                <div className="row wrap" style={{ gap: 8 }}>
                  <div className="field"><label htmlFor="ck">Change</label><select id="ck" name="kind" className="input select">{Object.entries(CHANGE_KINDS).map(([k, l]) => <option key={k} value={k}>{l}{NEEDS_APPROVAL.includes(k as ChangeKind) ? " (needs approval)" : ""}</option>)}</select></div>
                  <div className="field" style={{ flex: 1, minWidth: 200 }}><label htmlFor="cn">Campaign name</label><input id="cn" name="campaignName" className="input" required maxLength={120} /></div>
                  <div className="field"><label htmlFor="cd">Daily budget ₹</label><input id="cd" name="daily" className="input" inputMode="decimal" style={{ width: 110 }} /></div>
                  <div className="field"><label htmlFor="ct">Total budget ₹</label><input id="ct" name="total" className="input" inputMode="decimal" style={{ width: 110 }} /></div>
                  <div className="field"><label htmlFor="cs">Start</label><input id="cs" name="startDate" type="date" className="input" /></div>
                  <div className="field"><label htmlFor="ce">End</label><input id="ce" name="endDate" type="date" className="input" /></div>
                </div>
                <div className="field"><label htmlFor="cx">Details for the merchant (audience, ads, why)</label><textarea id="cx" name="details" className="input" rows={2} maxLength={2000} /></div>
                <p className="tiny muted" style={{ margin: 0 }}>New campaigns, budget increases and restarts go to the merchant for approval and must stay within their monthly limit. Other changes are recorded as done and shown in their history.</p>
                <div><button className="btn btn-orange btn-sm">Submit</button></div>
              </form>
            )}

            <div className="tbl-wrap" style={{ marginTop: 14 }}>
              {changes.length === 0 ? <p className="small muted">No campaign changes yet.</p> : (
                <table className="tbl"><thead><tr><th>Date</th><th>Change</th><th>Budget</th><th>Status</th><th>Who</th><th /></tr></thead>
                  <tbody>{changes.map((c) => (
                    <tr key={c.id}>
                      <td className="small">{day(c.createdAt)}</td>
                      <td className="small">{CHANGE_KINDS[c.kind as ChangeKind] ?? c.kind}: <b>{c.campaignName}</b>{c.details && <div className="tiny muted" style={{ maxWidth: 300 }}>{c.details}</div>}</td>
                      <td className="small">{budgetText(c) || "—"}</td>
                      <td className="small">{c.status}{c.metaCampaignId && <div className="tiny muted mono">Meta {c.metaCampaignId}</div>}{c.decisionNote && <div className="tiny muted">{c.decisionNote}</div>}</td>
                      <td className="tiny muted">by {names.get(c.proposedBy) ?? "staff"}{c.decidedAt && <><br />{c.status === "rejected" ? "rejected" : "approved"} by merchant {day(c.decidedAt)}</>}{c.appliedAt && c.needsApproval && <><br />set up by {names.get(c.appliedBy ?? "") ?? "staff"} {day(c.appliedAt)}</>}</td>
                      <td>{manage && c.status === "approved" && (
                        <form action={staffAdChangeAction} className="row" style={{ gap: 4 }}><input type="hidden" name="storeId" value={s.id} /><input type="hidden" name="changeId" value={c.id} /><input type="hidden" name="action" value="applied" />
                          <input name="metaCampaignId" className="input mono" placeholder="Meta campaign ID" aria-label="Meta campaign ID" style={{ width: 150, height: 30, fontSize: 12 }} />
                          <button className="btn btn-sm btn-orange">Mark done</button></form>
                      )}
                        {manage && (c.status === "pending" || c.status === "approved") && (
                          <form action={staffAdChangeAction} style={{ marginTop: 4 }}><input type="hidden" name="storeId" value={s.id} /><input type="hidden" name="changeId" value={c.id} /><input type="hidden" name="action" value="withdrawn" />
                            <button className="btn btn-sm btn-outline">Withdraw</button></form>
                        )}</td>
                    </tr>
                  ))}</tbody></table>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}
