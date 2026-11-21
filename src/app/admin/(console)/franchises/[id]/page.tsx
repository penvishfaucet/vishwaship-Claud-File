import { notFound } from "next/navigation";
import { CheckCircle2, Circle } from "lucide-react";
import { and, desc, eq } from "drizzle-orm";
import { DEPOSIT_METHOD_LABEL, DEPOSIT_STATE_LABEL, STATUS_CHIP, STATUS_LABEL, activationChecklist, depositSummary, rupeesText, termState } from "@/lib/franchise";
import {
  addFranchiseArea, recordFranchiseAgreement, recordFranchiseDeposit, releaseFranchiseArea, setFranchiseKyc, setFranchiseStatus, settleFranchiseDeposit,
} from "@/server/admin/franchise-actions";
import { can } from "@/server/auth/rbac";
import { requireStaff } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { areasOf, currentTerms, depositsOf, getFranchise } from "@/server/franchise/service";
import { DistrictFields, FranchiseForm } from "../forms";

const day = (d: Date | null) => (d ? d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" }) : "—");
const when = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const ist = (d: Date | null) => (d ? new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10) : "");
const todayIst = () => ist(new Date());
const ACTION_LABEL: Record<string, string> = {
  "franchise.created": "Created", "franchise.updated": "Details edited", "franchise.area_added": "Area added", "franchise.area_released": "Area released",
  "franchise.deposit_recorded": "Deposit recorded", "franchise.deposit_settled": "Deposit closed", "franchise.kyc_verified": "KYC verified", "franchise.kyc_unverified": "KYC mark removed",
  "franchise.agreement_recorded": "Signed agreement recorded", "franchise.status_active": "Activated", "franchise.status_suspended": "Suspended", "franchise.status_terminated": "Terminated",
};

export default async function FranchiseDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ok?: string; err?: string; edit?: string }> }) {
  const staff = await requireStaff("customers.read");
  const { id } = await params;
  const sp = await searchParams;
  const f = await getFranchise(id);
  if (!f) notFound();
  const db = await getDb();
  const [areas, history, deps, terms, log] = await Promise.all([
    areasOf(f.id), areasOf(f.id, true), depositsOf(f.id), currentTerms(),
    db.select().from(schema.auditLog).where(and(eq(schema.auditLog.targetType, "franchise"), eq(schema.auditLog.targetId, f.id))).orderBy(desc(schema.auditLog.createdAt)).limit(60),
  ]);
  const actors = [...new Set(log.map((l) => l.actorUserId).filter(Boolean))] as string[];
  const names = new Map((actors.length ? await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(eq(schema.users.kind, "staff")) : []).map((u) => [u.id, u.name]));
  const dep = depositSummary(f.depositRequiredPaise, deps);
  const checklist = activationChecklist(f, areas.length, dep, terms.version);
  const write = can(staff.role, "customers.write"), finance = can(staff.role, "finance.adjust"), owner = can(staff.role, "modules.manage");
  const closed = f.status === "terminated";
  const addr = (f.address ?? null) as { line1?: string; line2?: string; city?: string; state?: string; pincode?: string } | null;
  const ts = termState(f.termEnd);
  const released = history.filter((a) => a.releasedAt);

  return (
    <>
      <div className="page-h">
        <div><p className="small muted" style={{ margin: 0 }}><a href="/admin/franchises/">Franchises</a></p>
          <h1>{f.businessName}</h1>
          <p className="small muted" style={{ margin: "4px 0 0" }}><span className="mono">{f.code}</span> · {f.ownerName} · {f.mobile} · {f.email} · <span className={`chip ${STATUS_CHIP[f.status]}`}>{STATUS_LABEL[f.status]}</span></p>
          {f.statusReason && <p className="small red" style={{ margin: "4px 0 0" }}>Reason: {f.statusReason}</p>}
        </div>
        {write && !closed && <a className="btn btn-outline" href={sp.edit ? `/admin/franchises/${f.id}/` : `/admin/franchises/${f.id}/?edit=1`}>{sp.edit ? "Close edit" : "Edit details"}</a>}
      </div>
      {sp.ok && <p className="note small mb12">{sp.ok}</p>}
      {sp.err && <p className="err-box small mb12" role="alert">{sp.err}</p>}

      {sp.edit && write && !closed && (
        <div style={{ maxWidth: 820, marginBottom: 16 }}>
          <FranchiseForm init={{ id: f.id, businessName: f.businessName, ownerName: f.ownerName, mobile: f.mobile, email: f.email, gstin: f.gstin ?? "", pan: f.pan ?? "",
            line1: addr?.line1 ?? "", line2: addr?.line2 ?? "", city: addr?.city ?? "", state: addr?.state ?? "", pincode: addr?.pincode ?? "",
            depositRupees: String(f.depositRequiredPaise / 100), monthlyTarget: String(f.monthlyTargetShipments), termStart: ist(f.termStart), termEnd: ist(f.termEnd), notes: f.notes ?? "" }} />
        </div>
      )}

      <div className="grid2" style={{ alignItems: "start" }}>
        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ fontSize: 14, marginBottom: 8 }}>Overview</h3>
          <dl className="kv-list">
            <dt>PAN / GSTIN</dt><dd>{f.pan ?? "—"} / {f.gstin ?? "—"}</dd>
            <dt>Address</dt><dd>{addr ? [addr.line1, addr.line2, addr.city, addr.state, addr.pincode].filter(Boolean).join(", ") : "—"}</dd>
            <dt>Term</dt><dd>{day(f.termStart)} – {day(f.termEnd)}{ts === "ended" && <span className="red"> (ended)</span>}{ts === "ending" && <span style={{ color: "#b54708" }}> (ends within 30 days)</span>}</dd>
            <dt>Monthly target</dt><dd>{f.monthlyTargetShipments ? `${f.monthlyTargetShipments.toLocaleString("en-IN")} shipments` : "No target"}</dd>
            <dt>Terms signed</dt><dd>{f.termsVersion ? `v${f.termsVersion} on ${day(f.agreementSignedAt)}` : "Not yet"}{f.termsVersion && terms.version > f.termsVersion && <span className="muted"> (latest is v{terms.version})</span>}</dd>
            <dt>KYC</dt><dd>{f.kycVerifiedAt ? `Verified ${day(f.kycVerifiedAt)}` : "Not verified"}</dd>
            <dt>Created</dt><dd>{day(f.createdAt)}{f.activatedAt && ` · first activated ${day(f.activatedAt)}`}</dd>
            {f.notes && <><dt>Notes</dt><dd style={{ whiteSpace: "pre-wrap", fontWeight: 400 }}>{f.notes}</dd></>}
          </dl>
          {write && !closed && (
            <div style={{ display: "grid", gap: 10, marginTop: 14, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
              <form action={setFranchiseKyc} className="row" style={{ gap: 8 }}>
                <input type="hidden" name="franchiseId" value={f.id} /><input type="hidden" name="verified" value={f.kycVerifiedAt ? "0" : "1"} />
                <button className="btn btn-sm btn-outline">{f.kycVerifiedAt ? "Remove KYC verified" : "Mark KYC verified"}</button>
                <span className="tiny muted">PAN, address proof, bank details{f.gstin ? ", GST certificate" : ""} checked</span>
              </form>
              <form action={recordFranchiseAgreement} className="row wrap" style={{ gap: 8, alignItems: "flex-end" }}>
                <input type="hidden" name="franchiseId" value={f.id} />
                <div className="field"><label htmlFor="signedOn">Agreement signed on</label><input id="signedOn" name="signedOn" type="date" className="input" defaultValue={todayIst()} max={todayIst()} required /></div>
                <button className="btn btn-sm btn-outline" disabled={terms.version === 0}>Record signed agreement (Terms v{terms.version || "—"})</button>
                {terms.version === 0 && <span className="tiny muted">Publish the Terms first (<a href="/admin/franchises/?tab=terms">Terms &amp; Conditions</a>).</span>}
              </form>
            </div>
          )}
        </div>

        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ fontSize: 14, marginBottom: 8 }}>Status</h3>
          {f.status !== "active" && !closed && (
            <ul style={{ listStyle: "none", padding: 0, margin: "0 0 12px", display: "grid", gap: 6 }}>
              {checklist.map((c) => <li key={c.key} className="small row" style={{ gap: 6 }}>{c.ok ? <CheckCircle2 size={16} color="#12805c" aria-hidden /> : <Circle size={16} color="#98a2b3" aria-hidden />}<span>{c.label}</span><span className="sr-only">{c.ok ? "done" : "to do"}</span></li>)}
            </ul>
          )}
          {owner && !closed ? (
            <div style={{ display: "grid", gap: 10 }}>
              {f.status !== "active" && (
                <form action={setFranchiseStatus}><input type="hidden" name="franchiseId" value={f.id} /><input type="hidden" name="status" value="active" />
                  <button className="btn btn-orange" disabled={checklist.some((c) => !c.ok)}>{f.status === "suspended" ? "Re-activate franchise" : "Activate franchise"}</button></form>
              )}
              <form action={setFranchiseStatus} style={{ display: "grid", gap: 8 }}>
                <input type="hidden" name="franchiseId" value={f.id} />
                <div className="field"><label htmlFor="reason">Reason (kept in the record)</label><input id="reason" name="reason" className="input" minLength={5} maxLength={500} required /></div>
                <div className="row" style={{ gap: 8 }}>
                  {f.status === "active" && <button className="btn btn-outline" name="status" value="suspended">Suspend</button>}
                  <button className="btn btn-outline red" name="status" value="terminated">Terminate</button>
                </div>
                <p className="tiny muted" style={{ margin: 0 }}>Terminate is final: all areas are released for other franchises. Close the deposit afterwards (refund / forfeit).</p>
              </form>
            </div>
          ) : !closed ? <p className="tiny muted">Only the owner can activate, suspend or terminate.</p> : <p className="small muted">This franchise is terminated.</p>}
        </div>
      </div>

      <div className="grid2" style={{ alignItems: "start", marginTop: 16 }}>
        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ fontSize: 14, marginBottom: 8 }}>Areas (exclusive)</h3>
          {areas.length === 0 ? <p className="small muted">No area yet.</p> : (
            <table className="tbl"><tbody>{areas.map((a) => (
              <tr key={a.id}>
                <td className="small">{a.kind === "district" ? <><b>{a.district}</b> district</> : <>PIN <b className="mono">{a.pincode}</b> <span className="muted">({a.district})</span></>}</td>
                <td className="small">{a.state}</td><td className="small muted">{day(a.createdAt)}</td>
                <td>{write && <form action={releaseFranchiseArea}><input type="hidden" name="franchiseId" value={f.id} /><input type="hidden" name="areaId" value={a.id} /><button className="btn btn-sm btn-ghost">Release</button></form>}</td>
              </tr>
            ))}</tbody></table>
          )}
          {write && !closed && (
            <>
              <form action={addFranchiseArea} className="row wrap" style={{ gap: 8, marginTop: 12, alignItems: "flex-end" }}>
                <input type="hidden" name="franchiseId" value={f.id} /><input type="hidden" name="kind" value="district" />
                <DistrictFields idPrefix="add" defaultState={addr?.state ?? ""} />
                <button className="btn btn-outline">Add district</button>
              </form>
              <form action={addFranchiseArea} className="row wrap" style={{ gap: 8, marginTop: 8, alignItems: "flex-end" }}>
                <input type="hidden" name="franchiseId" value={f.id} /><input type="hidden" name="kind" value="pincode" />
                <div className="field"><label htmlFor="pin">Or one PIN only</label><input id="pin" name="pincode" className="input" inputMode="numeric" maxLength={6} pattern="[1-9][0-9]{5}" required style={{ width: 120 }} /></div>
                <button className="btn btn-outline">Add PIN</button>
              </form>
              <p className="tiny muted">One district or PIN can belong to only one franchise. A PIN inside a district that another franchise holds is refused.</p>
            </>
          )}
          {released.length > 0 && <details style={{ marginTop: 10 }}><summary className="small muted">Released areas ({released.length})</summary>
            <table className="tbl"><tbody>{released.map((a) => <tr key={a.id}><td className="small">{a.kind === "district" ? a.district : `PIN ${a.pincode}`}, {a.state}</td><td className="small muted">{day(a.createdAt)} – {day(a.releasedAt)}</td></tr>)}</tbody></table></details>}
        </div>

        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ fontSize: 14, marginBottom: 8 }}>Security deposit</h3>
          <dl className="kv-list">
            <dt>Required</dt><dd>{rupeesText(dep.requiredPaise)}</dd>
            <dt>Held now</dt><dd>{rupeesText(dep.heldPaise)} · {DEPOSIT_STATE_LABEL[dep.state]}{dep.duePaise > 0 && <span className="red"> · {rupeesText(dep.duePaise)} due</span>}</dd>
            {(dep.refundedPaise > 0 || dep.forfeitedPaise > 0) && <><dt>Closed</dt><dd>Refunded {rupeesText(dep.refundedPaise)} · forfeited {rupeesText(dep.forfeitedPaise)}</dd></>}
          </dl>
          {deps.map((d) => (
            <div key={d.id} style={{ borderTop: "1px solid var(--line)", padding: "8px 0", marginTop: 8 }}>
              <div className="small"><span className="mono">{d.receiptNumber}</span> · <b>{rupeesText(d.amountPaise)}</b> · {DEPOSIT_METHOD_LABEL[d.method]}{d.reference && <> · <span className="mono">{d.reference}</span></>} · received {day(d.receivedOn)} · <b>{d.status.replace("_", " ")}</b></div>
              {d.status !== "held" && <div className="tiny muted">Refund {rupeesText(d.refundPaise)}{d.refundReference && ` (UTR ${d.refundReference})`} · forfeit {rupeesText(d.forfeitPaise)} · {d.decisionNote} · {d.decidedAt && day(d.decidedAt)}</div>}
              {d.status === "held" && finance && f.status !== "active" && (
                <details style={{ marginTop: 6 }}><summary className="small">Close this deposit (refund / forfeit)</summary>
                  <form action={settleFranchiseDeposit} style={{ display: "grid", gap: 8, marginTop: 8 }}>
                    <input type="hidden" name="franchiseId" value={f.id} /><input type="hidden" name="depositId" value={d.id} />
                    <div className="grid2">
                      <div className="field"><label htmlFor={`r-${d.id}`}>Refund (₹)</label><input id={`r-${d.id}`} name="refundRupees" className="input" inputMode="decimal" defaultValue={d.amountPaise / 100} /></div>
                      <div className="field"><label htmlFor={`fo-${d.id}`}>Forfeit (₹)</label><input id={`fo-${d.id}`} name="forfeitRupees" className="input" inputMode="decimal" defaultValue={0} /></div>
                    </div>
                    <div className="field"><label htmlFor={`u-${d.id}`}>Refund UTR (after paying it back)</label><input id={`u-${d.id}`} name="refundReference" className="input" maxLength={40} /></div>
                    <div className="field"><label htmlFor={`n-${d.id}`}>Reason / note</label><input id={`n-${d.id}`} name="note" className="input" minLength={5} maxLength={500} required /></div>
                    <div><button className="btn btn-sm btn-outline">Close deposit</button></div>
                  </form>
                </details>
              )}
            </div>
          ))}
          {finance && !closed ? (
            <form action={recordFranchiseDeposit} style={{ display: "grid", gap: 8, marginTop: 12, borderTop: "1px solid var(--line)", paddingTop: 12 }}>
              <input type="hidden" name="franchiseId" value={f.id} />
              <b className="small">Record a deposit received</b>
              <div className="grid2">
                <div className="field"><label htmlFor="amt">Amount (₹)</label><input id="amt" name="amountRupees" className="input" inputMode="numeric" defaultValue={dep.duePaise ? dep.duePaise / 100 : ""} required /></div>
                <div className="field"><label htmlFor="mth">Paid by</label><select id="mth" name="method" className="input select" defaultValue="bank_transfer">{Object.entries(DEPOSIT_METHOD_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
                <div className="field"><label htmlFor="ref">UTR / cheque no.</label><input id="ref" name="reference" className="input" maxLength={40} /></div>
                <div className="field"><label htmlFor="rcv">Received on</label><input id="rcv" name="receivedOn" type="date" className="input" defaultValue={todayIst()} max={todayIst()} required /></div>
              </div>
              <p className="tiny muted" style={{ margin: 0 }}>Record only money already in Vishwaship&apos;s bank account. Never enter card or account numbers here.</p>
              <div><button className="btn btn-sm btn-orange">Record deposit</button></div>
            </form>
          ) : !finance ? <p className="tiny muted" style={{ marginTop: 10 }}>Finance records deposits and refunds.</p> : null}
          {finance && f.status === "active" && deps.some((d) => d.status === "held") && <p className="tiny muted">A deposit can be closed after the franchise is suspended or terminated.</p>}
        </div>
      </div>

      <div className="card p0" style={{ marginTop: 16 }}><div className="card-h"><b>History</b></div>
        {log.length === 0 ? <p className="small muted" style={{ padding: 16 }}>No activity yet.</p> : (
          <table className="tbl"><tbody>{log.map((l) => {
            const d = (l.details ?? {}) as Record<string, unknown>;
            const extra = [d.district && `${d.district}, ${d.state}`, d.pincode && `PIN ${d.pincode}`, d.receiptNumber, typeof d.amountPaise === "number" && rupeesText(d.amountPaise), d.reason, d.termsVersion && `Terms v${d.termsVersion}`, Array.isArray(d.changed) && d.changed.length > 0 && `changed: ${(d.changed as string[]).join(", ")}`].filter(Boolean).join(" · ");
            return <tr key={l.id}><td className="small">{ACTION_LABEL[l.action] ?? l.action}</td><td className="small muted">{extra}</td><td className="small">{(l.actorUserId && names.get(l.actorUserId)) ?? l.actorKind}</td><td className="small muted">{when(l.createdAt)}</td></tr>;
          })}</tbody></table>
        )}
      </div>
    </>
  );
}
