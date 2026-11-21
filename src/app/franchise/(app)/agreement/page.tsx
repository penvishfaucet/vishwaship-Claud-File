import { eq } from "drizzle-orm";
import { DEPOSIT_STATE_LABEL, depositSummary, rupeesText } from "@/lib/franchise";
import { getDb, schema } from "@/server/db/client";
import { areasOf, depositsOf } from "@/server/franchise/service";
import { requireFranchise } from "@/server/franchise/session";
import { day } from "../parts";

export default async function FranchiseAgreement() {
  const { franchise: f } = await requireFranchise();
  const db = await getDb();
  const [areas, deps, terms] = await Promise.all([
    areasOf(f.id), depositsOf(f.id),
    f.termsVersion ? db.select().from(schema.franchiseTerms).where(eq(schema.franchiseTerms.version, f.termsVersion)) : Promise.resolve([]),
  ]);
  const dep = depositSummary(f.depositRequiredPaise, deps);
  return (
    <>
      <div className="page-h"><div><h1>Agreement</h1><p className="small muted" style={{ margin: "4px 0 0" }}>Your area, term, deposit and the Terms you signed.</p></div></div>
      <div className="grid2" style={{ alignItems: "start" }}>
        <div className="card" style={{ padding: 16 }}>
          <dl className="kv-list">
            <dt>Franchise code</dt><dd className="mono">{f.code}</dd>
            <dt>Term</dt><dd>{day(f.termStart)} – {day(f.termEnd)}</dd>
            <dt>Monthly target</dt><dd>{f.monthlyTargetShipments ? `${f.monthlyTargetShipments.toLocaleString("en-IN")} shipments` : "None"}</dd>
            <dt>Security deposit</dt><dd>{rupeesText(dep.heldPaise)} held of {rupeesText(dep.requiredPaise)} · {DEPOSIT_STATE_LABEL[dep.state]}</dd>
            <dt>Agreement signed</dt><dd>{f.termsVersion ? `Terms v${f.termsVersion}, ${day(f.agreementSignedAt)}` : "Not recorded yet"}</dd>
          </dl>
        </div>
        <div className="card" style={{ padding: 16 }}>
          <h3 style={{ fontSize: 14, marginTop: 0 }}>Your exclusive area</h3>
          {areas.length === 0 ? <p className="small muted">No area yet.</p> : (
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{areas.map((a) => <li key={a.id}>{a.kind === "district" ? `${a.district} district, ${a.state}` : `PIN ${a.pincode} (${a.district}, ${a.state})`}</li>)}</ul>
          )}
        </div>
      </div>
      {terms[0] && (
        <div className="card" style={{ padding: 16, marginTop: 16 }}>
          <h3 style={{ fontSize: 14, marginTop: 0 }}>Terms &amp; Conditions (v{terms[0].version})</h3>
          <div className="small" style={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>{terms[0].body}</div>
        </div>
      )}
    </>
  );
}
