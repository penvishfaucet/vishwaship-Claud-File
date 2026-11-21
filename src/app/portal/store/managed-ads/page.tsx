import { CheckCircle2, Circle } from "lucide-react";
import { AdsStatusButtons, ApproveChange, CheckToggle, DepositPay, RefundRequest, TermsAccept } from "@/components/portal/store/Billing";
import { budgetText } from "@/lib/store-plan";
import { rupees } from "@/lib/store-themes";
import { CHANGE_KINDS, type ChangeKind, activeDeposit, adChanges, adsChecklist, billingConfig, depositHistory, managedAdsRow, staffNames } from "@/server/store/billing";
import { requireStorePage } from "@/server/store/portal";
import "@/styles/store.css";

export const metadata = { title: "Managed Meta Ads — Vishwaship" };
const day = (d: Date | null) => (d ? d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" }) : "—");
const STATUS: Record<string, [string, string]> = {
  onboarding: ["c-draft", "Getting ready"], active: ["c-active", "Running"], paused: ["c-draft", "Paused"], ended: ["c-cancelled", "Ended"],
};
const CHANGE_CHIP: Record<string, [string, string]> = {
  pending: ["c-draft", "Waiting for your approval"], approved: ["c-active", "Approved · being set up"], applied: ["c-active", "Done"],
  rejected: ["c-cancelled", "Rejected"], withdrawn: ["c-draft", "Withdrawn"],
};

export default async function ManagedAdsPage() {
  const { ctx, store } = await requireStorePage();
  const [cfg, m, list, dep, deps, changes] = await Promise.all([billingConfig(), managedAdsRow(store.id), adsChecklist(store), activeDeposit(store.id), depositHistory(store.id), adChanges(store.id)]);
  const names = await staffNames([store.assignedStaffId]);
  const manager = store.assignedStaffId ? names.get(store.assignedStaffId)?.split(" ")[0] : null;
  const status = m?.status ?? "onboarding";
  const termsOk = !!m?.termsAcceptedAt && m.termsVersion === cfg.termsVersion;
  const pending = changes.filter((c) => c.status === "pending");
  const done = list.filter((i) => i.ok).length;
  return (
    <>
      <div className="page-h">
        <div><p className="small muted" style={{ margin: 0 }}><a href="/portal/store/">Online Store</a></p><h1>Managed Meta Ads</h1>
          <p className="small muted" style={{ margin: "4px 0 0", maxWidth: 760 }}>Vishwaship&apos;s team runs Facebook & Instagram ads for your store in your own Meta ad account. Meta charges ad spend to your ad account; nothing is spent without your approval.</p></div>
        <span className={`chip ${STATUS[status][0]}`}>{STATUS[status][1]}</span>
      </div>

      {pending.length > 0 && (
        <div className="card" style={{ padding: 16, marginBottom: 16, maxWidth: 860, borderColor: "var(--orange)" }}>
          <h3 style={{ margin: 0 }}>Waiting for your approval ({pending.length})</h3>
          {pending.map((c) => (
            <div key={c.id} style={{ borderTop: "1px solid var(--line)", marginTop: 12, paddingTop: 12 }}>
              <b>{CHANGE_KINDS[c.kind as ChangeKind] ?? c.kind}: {c.campaignName}</b>
              <div className="small">Budget: {budgetText(c)}</div>
              {c.details && <p className="small" style={{ whiteSpace: "pre-wrap", margin: "4px 0" }}>{c.details}</p>}
              <div className="tiny muted">Proposed {day(c.createdAt)}</div>
              <ApproveChange id={c.id} budgetText={budgetText(c)} />
            </div>
          ))}
        </div>
      )}

      <div className="grid2" style={{ alignItems: "start", maxWidth: 1100 }}>
        <div className="card" style={{ padding: 16 }}>
          <div className="row between"><h3 style={{ margin: 0 }}>Onboarding checklist</h3><span className="small muted">{done}/{list.length} done</span></div>
          <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0", display: "grid", gap: 10 }}>
            {list.map((i) => (
              <li key={i.key} className="row" style={{ gap: 8, alignItems: "flex-start" }}>
                {i.ok ? <CheckCircle2 size={18} color="var(--green)" aria-label="Done" /> : <Circle size={18} color="var(--muted)" aria-label="Not done" />}
                <div style={{ flex: 1 }}>
                  <div className="small"><b>{i.label}</b>{i.who === "staff" && <span className="tiny muted"> · Vishwaship</span>}</div>
                  {!i.ok && <div className="tiny muted">{i.hint}{i.href && <> <a className="orange" href={i.href}>Open</a></>}</div>}
                  {i.who === "merchant" && status !== "ended" && <div style={{ marginTop: 4 }}><CheckToggle itemKey={i.key} done={i.ok} label="Mark done" /></div>}
                </div>
              </li>
            ))}
          </ul>
          <p className="small muted" style={{ marginBottom: 0 }}>{manager ? `Your account manager: ${manager}. ` : ""}When everything is ticked, your account manager starts the service.</p>
          {status !== "onboarding" && <div style={{ marginTop: 12 }}><AdsStatusButtons status={status} /></div>}
        </div>

        <div style={{ display: "grid", gap: 16 }}>
          <div className="card" style={{ padding: 16 }}>
            <h3 style={{ marginTop: 0 }}>Terms</h3>
            {status === "ended" ? <p className="small muted">The service has ended.</p>
              : <TermsAccept terms={cfg.terms} version={cfg.termsVersion} accepted={termsOk} capRupees={m?.monthlyCapPaise ? m.monthlyCapPaise / 100 : null} />}
            {m?.termsAcceptedAt && <p className="tiny muted" style={{ marginBottom: 0 }}>Accepted version {m.termsVersion} on {day(m.termsAcceptedAt)}{m.monthlyCapPaise ? ` · monthly limit ${rupees(m.monthlyCapPaise)}` : ""}</p>}
          </div>
          <div className="card" style={{ padding: 16 }}>
            <h3 style={{ marginTop: 0 }}>Security deposit</h3>
            {dep ? (
              <>
                <p className="small" style={{ marginTop: 0 }}><b>{rupees(dep.amountPaise)}</b> held since {day(dep.createdAt)} · <a className="orange" href={`/portal/store/receipts/${dep.id}/`}>Receipt {dep.receiptNumber}</a></p>
                {dep.status === "refund_requested" ? <p className="small"><span className="chip c-draft">Refund requested</span> on {day(dep.refundRequestedAt)}. Vishwaship pays approved refunds to your wallet within {cfg.refundDays} working days.</p>
                  : <RefundRequest canRequest={status !== "active"} why={status === "active" ? "To get the deposit back, end the service first." : undefined} />}
                {dep.status === "held" && dep.decisionNote && <p className="small" style={{ marginBottom: 0 }}>Last refund request was not approved: {dep.decisionNote}</p>}
              </>
            ) : status === "ended" ? <p className="small muted">No deposit is held.</p> : (
              <>
                <p className="small muted" style={{ marginTop: 0 }}>A refundable deposit of {rupees(cfg.depositPaise)} is held from your wallet before the service starts. It is not spent on ads.</p>
                <DepositPay amountPaise={cfg.depositPaise} walletPaise={ctx.walletAvailable} ready={termsOk} />
              </>
            )}
            {deps.filter((d) => d.id !== dep?.id).map((d) => (
              <p key={d.id} className="tiny muted" style={{ margin: "8px 0 0" }}>{d.receiptNumber}: {rupees(d.amountPaise)} · {d.status === "refunded" ? `refunded ${rupees(d.refundPaise ?? 0)}` : "not refunded"} {day(d.decidedAt)}{d.decisionNote ? ` · ${d.decisionNote}` : ""} · <a className="orange" href={`/portal/store/receipts/${d.id}/`}>receipt</a></p>
            ))}
          </div>
        </div>
      </div>

      <div className="card p0" style={{ marginTop: 16, maxWidth: 1100 }}>
        <div className="card-h"><b>Campaign change history</b></div>
        {changes.length === 0 ? <p className="small muted" style={{ padding: 16, margin: 0 }}>No campaign changes yet.</p> : (
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Date</th><th>Change</th><th>Campaign</th><th>Budget</th><th>Status</th></tr></thead>
            <tbody>{changes.map((c) => (
              <tr key={c.id}>
                <td className="small">{day(c.createdAt)}</td><td className="small">{CHANGE_KINDS[c.kind as ChangeKind] ?? c.kind}</td>
                <td className="small">{c.campaignName}{c.details && <div className="tiny muted" style={{ maxWidth: 320 }}>{c.details}</div>}</td>
                <td className="small">{c.dailyBudgetPaise || c.totalBudgetPaise ? budgetText(c) : "—"}</td>
                <td className="small"><span className={`chip ${CHANGE_CHIP[c.status]?.[0] ?? "c-draft"}`}>{CHANGE_CHIP[c.status]?.[1] ?? c.status}</span>
                  {c.decidedAt && <div className="tiny muted">{c.status === "approved" || c.status === "applied" ? "Approved" : c.status === "rejected" ? "Rejected" : "Decided"} {day(c.decidedAt)}{c.decisionNote ? `: ${c.decisionNote}` : ""}</div>}</td>
              </tr>
            ))}</tbody></table></div>
        )}
      </div>
    </>
  );
}
