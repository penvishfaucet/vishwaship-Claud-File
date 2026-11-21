import { DEPOSIT_STATE_LABEL, STATUS_CHIP, STATUS_LABEL, rupeesText, termState } from "@/lib/franchise";
import { INDIA_STATES } from "@/lib/india-districts";
import { publishFranchiseTerms } from "@/server/admin/franchise-actions";
import { can } from "@/server/auth/rbac";
import { requireStaff } from "@/server/auth/session";
import { FranchiseError, areaStatus, currentTerms, listFranchises, termsVersions } from "@/server/franchise/service";
import { DistrictFields } from "./forms";

type SP = Promise<{ tab?: string; status?: string; state?: string; q?: string; cs?: string; cd?: string; ok?: string; err?: string }>;
const day = (d: Date | null) => (d ? d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" }) : "—");
const DEP_CHIP: Record<string, string> = { held: "c-active", not_required: "c-draft", partial: "c-draft", pending: "c-failed", closed: "c-draft" };

export default async function AdminFranchises({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const staff = await requireStaff("customers.read");
  const tab = ["area", "terms"].includes(sp.tab ?? "") ? sp.tab! : "list";
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
      <a className={tab === "terms" ? "on" : ""} href="/admin/franchises/?tab=terms">Terms &amp; Conditions</a>
    </nav>
  );
  const notes = <>{sp.ok && <p className="note small mb12">{sp.ok}</p>}{sp.err && <p className="err-box small mb12" role="alert">{sp.err}</p>}</>;

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
          <thead><tr><th>Code</th><th>Franchise</th><th>Areas</th><th>Deposit</th><th>Term</th><th>Status</th></tr></thead>
          <tbody>{rows.map(({ f, areas, deposit }) => {
            const ts = termState(f.termEnd);
            const names = areas.map((a) => (a.kind === "district" ? `${a.district}, ${a.state}` : `PIN ${a.pincode}`));
            return (
              <tr key={f.id}>
                <td className="small mono"><a href={`/admin/franchises/${f.id}/`}>{f.code}</a></td>
                <td className="small"><a href={`/admin/franchises/${f.id}/`}><b>{f.businessName}</b></a><div className="tiny muted">{f.ownerName} · {f.mobile}</div></td>
                <td className="small" style={{ maxWidth: 280 }}>{names.length ? <>{names.slice(0, 3).join("; ")}{names.length > 3 && <span className="muted"> +{names.length - 3} more</span>}</> : <span className="muted">None</span>}</td>
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
