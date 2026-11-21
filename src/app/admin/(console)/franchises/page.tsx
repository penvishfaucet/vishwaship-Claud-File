import { DEPOSIT_STATE_LABEL, STATUS_CHIP, STATUS_LABEL, rupeesText, termState } from "@/lib/franchise";
import { INDIA_STATES } from "@/lib/india-districts";
import {
  adjustFranchisePayout, approveFranchisePayout, cancelFranchisePayout, generateFranchisePayouts, payFranchisePayout, publishFranchiseTerms, saveFranchisePayoutSettings,
} from "@/server/admin/franchise-actions";
import { lastClosedPeriod, pctText, payoutConfig, payoutsList, periodLabel, unpaidByFranchise } from "@/server/franchise/commission";
import { can } from "@/server/auth/rbac";
import { requireStaff } from "@/server/auth/session";
import { FranchiseError, areaStatus, currentTerms, listFranchises, termsVersions } from "@/server/franchise/service";
import { sql } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { DistrictFields } from "./forms";

type SP = Promise<{ tab?: string; period?: string; status?: string; state?: string; q?: string; cs?: string; cd?: string; ok?: string; err?: string }>;
const day = (d: Date | null) => (d ? d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" }) : "—");
const DEP_CHIP: Record<string, string> = { held: "c-active", not_required: "c-draft", partial: "c-draft", pending: "c-failed", closed: "c-draft" };

export default async function AdminFranchises({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const staff = await requireStaff("customers.read");
  const tab = ["area", "terms", "payouts"].includes(sp.tab ?? "") ? sp.tab! : "list";
  const head = (
    <div className="page-h">
      <div><h1>Franchises</h1><p className="small muted" style={{ margin: "4px 0 0" }}>Franchise partners, their exclusive areas, security deposits and agreements. Every change is in the audit log.</p></div>
      {can(staff.role, "customers.write") && <a className="btn btn-orange" href="/admin/franchises/new/">+ New franchise</a>}
    </div>
  );
  const tabs = (
    <nav className="tabs mb12" aria-label="Franchises">
      <a className={tab === "list" ? "on" : ""} href="/admin/franchises/">All franchises</a>
      <a className={tab === "area" ? "on" : ""} href="/admin/franchises/?tab=area">Check an area</a>
      <a className={tab === "payouts" ? "on" : ""} href="/admin/franchises/?tab=payouts">Commission payouts</a>
      <a className={tab === "terms" ? "on" : ""} href="/admin/franchises/?tab=terms">Terms &amp; Conditions</a>
    </nav>
  );
  const notes = <>{sp.ok && <p className="note small mb12">{sp.ok}</p>}{sp.err && <p className="err-box small mb12" role="alert">{sp.err}</p>}</>;

  if (tab === "payouts") {
    const finance = can(staff.role, "finance.adjust");
    const last = lastClosedPeriod();
    const months: string[] = [];
    for (let i = 0, [y, m] = last.split("-").map(Number); i < 12; i++) { months.push(`${y}-${String(m).padStart(2, "0")}`); m--; if (m === 0) { m = 12; y--; } }
    const period = sp.period && months.includes(sp.period) ? sp.period : undefined;
    const [cfg, list, unpaid, frs] = await Promise.all([payoutConfig(), payoutsList({ period }), unpaidByFranchise(), listFranchises()]);
    const fname = new Map(frs.map((r) => [r.f.id, `${r.f.businessName} (${r.f.code})`]));
    const STATUS: Record<string, string> = { draft: "c-draft", approved: "c-draft", paid: "c-active", cancelled: "c-failed" };
    return (
      <>{head}{tabs}{notes}
        <div className="grid2 mb12" style={{ alignItems: "start" }}>
          <div className="card" style={{ padding: 16 }}>
            <h3 style={{ fontSize: 14, marginTop: 0 }}>Prepare statements</h3>
            <p className="tiny muted" style={{ marginTop: 0 }}>Makes a draft statement per franchise for the chosen month, including any older unpaid commission. Then adjust if needed, approve, pay by bank transfer and record the UTR.</p>
            {finance ? (
              <form action={generateFranchisePayouts} className="row wrap" style={{ gap: 8 }}>
                <select name="period" className="input select" defaultValue={last} style={{ width: "auto" }} aria-label="Month">{months.map((m) => <option key={m} value={m}>{periodLabel(m)}</option>)}</select>
                <button className="btn btn-orange">Prepare statements</button>
              </form>
            ) : <p className="tiny muted">Finance prepares and pays statements.</p>}
            {unpaid.length > 0 && <table className="tbl" style={{ marginTop: 10 }}><thead><tr><th>Unpaid, not in a statement</th><th>Shipments</th><th>Amount</th></tr></thead><tbody>{unpaid.map((u) => <tr key={u.franchiseId}><td className="small"><a href={`/admin/franchises/${u.franchiseId}/`}>{fname.get(u.franchiseId) ?? u.franchiseId}</a></td><td className="small">{u.n}</td><td className="small">{rupeesText(Number(u.sum))}</td></tr>)}</tbody></table>}
          </div>
          <form action={saveFranchisePayoutSettings} className="card" style={{ padding: 16, display: "grid", gap: 8 }}>
            <h3 style={{ fontSize: 14, margin: 0 }}>TDS on commission</h3>
            <div className="row" style={{ gap: 8 }}><input name="tdsPct" className="input" inputMode="decimal" defaultValue={cfg.tdsBps / 100} style={{ width: 90 }} aria-label="TDS percent" readOnly={!finance} /><span className="small">%</span>{finance && <button className="btn btn-sm btn-outline">Save</button>}</div>
            <p className="tiny muted" style={{ margin: 0 }}>Deducted from each new statement. Confirm the rate with your CA (commission is usually under section 194H). Statements already prepared keep their rate.</p>
          </form>
        </div>
        <form className="row wrap mb12" style={{ gap: 8 }} method="get" action="/admin/franchises/"><input type="hidden" name="tab" value="payouts" />
          <select name="period" className="input select" defaultValue={period ?? ""} style={{ width: "auto" }} aria-label="Filter month"><option value="">All months</option>{months.map((m) => <option key={m} value={m}>{periodLabel(m)}</option>)}</select>
          <button className="btn btn-outline">Show</button>
        </form>
        {list.length === 0 ? <div className="card empty"><p className="muted">No statements yet.</p></div> : (
          <div className="card p0 tbl-wrap"><table className="tbl">
            <thead><tr><th>Statement</th><th>Franchise</th><th>Shipments</th><th>Commission</th><th>TDS</th><th>Adjustment</th><th>Net</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>{list.map(({ p, code, name, last4, ifsc }) => (
              <tr key={p.id}>
                <td className="small mono">{p.statementNumber}<div className="tiny muted">{periodLabel(p.period)}</div></td>
                <td className="small"><a href={`/admin/franchises/${p.franchiseId}/`}>{name}</a><div className="tiny muted">{code} · {last4 ? `••${last4} ${ifsc}` : "no bank details"}</div></td>
                <td className="small">{p.shipments}</td><td className="small">{rupeesText(p.grossPaise)}</td>
                <td className="small">{rupeesText(p.tdsPaise)}<div className="tiny muted">{pctText(p.tdsBps)}</div></td>
                <td className="small">{p.adjustmentPaise ? rupeesText(p.adjustmentPaise) : "—"}{p.adjustmentNote && <div className="tiny muted">{p.adjustmentNote}</div>}</td>
                <td className="small"><b>{rupeesText(p.netPaise)}</b></td>
                <td><span className={`chip ${STATUS[p.status]}`}>{p.status}</span>{p.status === "paid" && <div className="tiny muted">UTR {p.utr}</div>}{p.status === "cancelled" && p.note && <div className="tiny muted">{p.note}</div>}</td>
                <td style={{ minWidth: 220 }}>{finance && p.status === "draft" && (<div style={{ display: "grid", gap: 6 }}>
                  <form action={approveFranchisePayout}><input type="hidden" name="payoutId" value={p.id} /><button className="btn btn-sm btn-orange">Approve</button></form>
                  <details><summary className="tiny">Adjust</summary><form action={adjustFranchisePayout} className="row wrap" style={{ gap: 4, marginTop: 4 }}><input type="hidden" name="payoutId" value={p.id} />
                    <input name="rupees" className="input" inputMode="decimal" placeholder="± ₹" style={{ width: 80, height: 28 }} aria-label="Adjustment rupees" /><input name="note" className="input" placeholder="What for" style={{ width: 120, height: 28 }} aria-label="Adjustment note" /><button className="btn btn-sm btn-outline">Save</button></form></details>
                </div>)}
                {finance && p.status === "approved" && (
                  <form action={payFranchisePayout} className="row wrap" style={{ gap: 4 }}><input type="hidden" name="payoutId" value={p.id} />
                    <input name="utr" className="input" placeholder="UTR" required style={{ width: 120, height: 28 }} aria-label="Payment UTR" /><input name="paidOn" type="date" className="input" required style={{ width: 140, height: 28 }} aria-label="Paid on" /><button className="btn btn-sm btn-orange">Mark paid</button></form>
                )}
                {finance && (p.status === "draft" || p.status === "approved") && (
                  <details style={{ marginTop: 4 }}><summary className="tiny">Cancel</summary><form action={cancelFranchisePayout} className="row" style={{ gap: 4, marginTop: 4 }}><input type="hidden" name="payoutId" value={p.id} />
                    <input name="reason" className="input" placeholder="Reason" required minLength={5} style={{ width: 140, height: 28 }} aria-label="Cancel reason" /><button className="btn btn-sm btn-ghost">Cancel</button></form></details>
                )}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </>
    );
  }

  if (tab === "terms") {
    const [cur, versions] = await Promise.all([currentTerms(), termsVersions()]);
    const write = can(staff.role, "modules.manage");
    return (
      <>{head}{tabs}{notes}
        <div className="grid2" style={{ alignItems: "start" }}>
          <form action={publishFranchiseTerms} className="card" style={{ padding: 16, display: "grid", gap: 10 }}>
            <h3 style={{ fontSize: 14, margin: 0 }}>{cur.version ? `Current version: v${cur.version}` : "Draft (not published yet)"}</h3>
            <p className="small muted" style={{ margin: 0 }}>{cur.version ? "Publishing a change creates a new version. Franchises stay on the version they signed until you record a new signed agreement." : "This is a starting draft. Edit it as needed and publish v1 before recording agreements."}</p>
            <textarea name="body" className="input" rows={28} defaultValue={cur.body} readOnly={!write} style={{ fontSize: 12.5, lineHeight: 1.5 }} aria-label="Terms and Conditions" />
            {write ? <div><button className="btn btn-orange">{cur.version ? `Publish as v${cur.version + 1}` : "Publish v1"}</button></div> : <p className="tiny muted">Only the owner can change the Terms.</p>}
          </form>
          <div className="card p0"><div className="card-h"><b>Versions</b></div>
            {versions.length === 0 ? <p className="small muted" style={{ padding: 16 }}>Nothing published yet.</p> : (
              <table className="tbl"><tbody>{versions.map((v) => <tr key={v.version}><td className="small">v{v.version}</td><td className="small">{day(v.createdAt)}</td><td className="small muted">{v.body.length.toLocaleString("en-IN")} characters</td></tr>)}</tbody></table>
            )}
          </div>
        </div>
      </>
    );
  }

  if (tab === "area") {
    let result: Awaited<ReturnType<typeof areaStatus>> | null = null, error = "";
    if (sp.cs && sp.cd) { try { result = await areaStatus(sp.cs, sp.cd); } catch (e) { if (e instanceof FranchiseError) error = e.message; else throw e; } }
    return (
      <>{head}{tabs}{notes}
        <form className="card row wrap" style={{ padding: 16, gap: 10, alignItems: "flex-end" }} method="get" action="/admin/franchises/">
          <input type="hidden" name="tab" value="area" />
          <DistrictFields idPrefix="chk" defaultState={sp.cs ?? ""} defaultDistrict={sp.cd ?? ""} />
          <button className="btn btn-outline">Check</button>
        </form>
        {error && <p className="err-box small" role="alert" style={{ marginTop: 12 }}>{error}</p>}
        {result && (
          <div className="card" style={{ padding: 16, marginTop: 12 }}>
            <p style={{ margin: 0 }}><b>{result.district}, {result.state}</b>: {result.holder
              ? <>belongs to <a href={`/admin/franchises/${result.holder.id}/`}>{result.holder.name} ({result.holder.code})</a></>
              : <span className="green">free — no franchise holds this district</span>}</p>
            {result.pins.length > 0 && <p className="small" style={{ margin: "8px 0 0" }}>PINs given separately in this district: {result.pins.map((p) => `${p.pin} (${p.code})`).join(", ")}</p>}
          </div>
        )}
      </>
    );
  }

  const rows = await listFranchises({ status: sp.status, state: sp.state, q: sp.q?.slice(0, 60) });
  const all = sp.status || sp.state || sp.q ? await listFranchises() : rows;
  const count = (st: string) => all.filter((r) => r.f.status === st).length;
  const db = await getDb();
  const custCounts = new Map((await db.select({ id: schema.orgs.franchiseId, n: sql<number>`count(*)::int` }).from(schema.orgs).where(sql`${schema.orgs.franchiseId} is not null`).groupBy(schema.orgs.franchiseId)).map((r) => [r.id, r.n]));
  return (
    <>{head}{tabs}{notes}
      <div className="grid3 mb12" style={{ gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))" }}>
        {(["active", "draft", "suspended", "terminated"] as const).map((st) => (
          <a key={st} className="card" style={{ padding: 12 }} href={`/admin/franchises/?status=${st}`}><div className="tiny muted">{STATUS_LABEL[st]}</div><div style={{ fontSize: 20, fontWeight: 700 }}>{count(st)}</div></a>
        ))}
      </div>
      <form className="row wrap mb12" style={{ gap: 8 }} method="get" action="/admin/franchises/">
        <input name="q" className="input" placeholder="Search code, name, mobile, district" defaultValue={sp.q ?? ""} style={{ flex: "1 1 240px", width: "auto" }} aria-label="Search" />
        <select name="status" className="input select" style={{ width: "auto" }} defaultValue={sp.status ?? ""} aria-label="Status"><option value="">All status</option>{Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select name="state" className="input select" style={{ width: "auto" }} defaultValue={sp.state ?? ""} aria-label="State"><option value="">All states</option>{INDIA_STATES.map((s) => <option key={s}>{s}</option>)}</select>
        <button className="btn btn-outline">Filter</button>{(sp.q || sp.status || sp.state) && <a className="btn btn-ghost" href="/admin/franchises/">Clear</a>}
      </form>
      {rows.length === 0 ? (
        <div className="card empty"><p className="muted">{all.length ? "No franchise matches these filters." : "No franchises yet. Create the first one with “+ New franchise”."}</p></div>
      ) : (
        <div className="card p0 tbl-wrap"><table className="tbl">
          <thead><tr><th>Code</th><th>Franchise</th><th>Areas</th><th>Customers</th><th>Deposit</th><th>Term</th><th>Status</th></tr></thead>
          <tbody>{rows.map(({ f, areas, deposit }) => {
            const ts = termState(f.termEnd);
            const names = areas.map((a) => (a.kind === "district" ? `${a.district}, ${a.state}` : `PIN ${a.pincode}`));
            return (
              <tr key={f.id}>
                <td className="small mono"><a href={`/admin/franchises/${f.id}/`}>{f.code}</a></td>
                <td className="small"><a href={`/admin/franchises/${f.id}/`}><b>{f.businessName}</b></a><div className="tiny muted">{f.ownerName} · {f.mobile}</div></td>
                <td className="small" style={{ maxWidth: 280 }}>{names.length ? <>{names.slice(0, 3).join("; ")}{names.length > 3 && <span className="muted"> +{names.length - 3} more</span>}</> : <span className="muted">None</span>}</td>
                <td className="small">{custCounts.get(f.id) ?? 0}</td>
                <td className="small"><span className={`chip ${DEP_CHIP[deposit.state]}`}>{DEPOSIT_STATE_LABEL[deposit.state]}</span><div className="tiny muted">{rupeesText(deposit.heldPaise)} of {rupeesText(deposit.requiredPaise)}</div></td>
                <td className="small">{f.termEnd ? <>till {day(f.termEnd)}{ts === "ended" ? <div className="tiny red">ended</div> : ts === "ending" ? <div className="tiny" style={{ color: "#b54708" }}>ends soon</div> : null}</> : <span className="muted">—</span>}</td>
                <td><span className={`chip ${STATUS_CHIP[f.status]}`}>{STATUS_LABEL[f.status] ?? f.status}</span></td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
    </>
  );
}
