import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { RTO_SOURCES, RTO_STATE_LABEL, rtoReport } from "@/server/rto/charges";
import { ConfirmRto, ImportRto, ResolveCod } from "./RtoAdmin";

const rs = (p: number | null | undefined) => (p === null || p === undefined ? "—" : `₹${(p / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`);
const day = (d: Date | null) => (d ? d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short" }) : "—");

/** Admin → Online Stores → RTO & COD: RTO charges of every customer (with the carrier's internal cost) and COD questions. */
export async function RtoTab({ state, awb, canWrite, showCost }: { state?: string; awb?: string; canWrite: boolean; showCost: boolean }) {
  const st = state && state in RTO_STATE_LABEL ? state : state === "all" ? undefined : "awaiting";
  const rows = (await rtoReport(null, { state: st, awb }, { internal: showCost })).slice(0, 300);
  const db = await getDb();
  const qs = await db.select({ d: schema.codDisputes, awb: schema.shipments.awb, org: schema.orgs.businessName }).from(schema.codDisputes)
    .innerJoin(schema.shipments, eq(schema.shipments.id, schema.codDisputes.shipmentId)).innerJoin(schema.orgs, eq(schema.orgs.id, schema.codDisputes.orgId))
    .where(and(eq(schema.codDisputes.status, "open"))).orderBy(desc(schema.codDisputes.createdAt)).limit(100);
  return (
    <div style={{ display: "grid", gap: 14 }}>
      {qs.length > 0 && (
        <div className="card p0">
          <div className="card-h"><b>COD questions from customers ({qs.length})</b></div>
          <table className="tbl"><tbody>{qs.map(({ d, awb: a, org }) => (
            <tr key={d.id}><td className="small">{org}<div className="tiny muted mono">{a}</div></td><td className="small">{d.note}<div className="tiny muted">{day(d.createdAt)}</div></td><td><ResolveCod id={d.id} canWrite={canWrite} /></td></tr>
          ))}</tbody></table>
        </div>
      )}
      {canWrite && <ImportRto />}
      <form className="row wrap" style={{ gap: 8, alignItems: "flex-end" }}>
        <input type="hidden" name="tab" value="rto" />
        <div className="field"><label htmlFor="rs">Status</label><select id="rs" name="state" className="input select" defaultValue={state ?? "awaiting"}><option value="all">All</option>{Object.entries(RTO_STATE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div className="field"><label htmlFor="ra">AWB / order</label><input id="ra" name="awb" className="input" defaultValue={awb ?? ""} /></div>
        <button className="btn btn-outline">Filter</button>
      </form>
      <div className="card p0" style={{ overflowX: "auto" }}>
        <table className="tbl">
          <thead><tr><th>Customer / order</th><th>AWB</th><th>RTO</th><th>Forward charged</th><th>Customer RTO charge</th>{showCost && <th>Carrier cost (internal)</th>}<th>Status</th><th /></tr></thead>
          <tbody>{rows.length ? rows.map((r) => (
            <tr key={r.shipmentId}>
              <td className="small">{r.customer}<div className="tiny muted">{r.orderNumber}</div></td>
              <td className="small mono">{r.courier}<div>{r.awb}</div></td>
              <td className="small">{day(r.rtoInitiatedAt)}{r.rtoDeliveredAt ? ` → ${day(r.rtoDeliveredAt)}` : ""}<div className="tiny muted">{r.reason ?? ""}</div></td>
              <td className="small">{rs(r.forwardTotalPaise)}</td>
              <td className="small">{r.estimated ? <>{rs(r.rtoChargePaise)} <span className="tiny muted">estimate</span></> : <>{rs(r.finalChargePaise)}<div className="tiny muted">wallet {rs(r.chargedPaise)} · {r.source ? RTO_SOURCES[r.source as keyof typeof RTO_SOURCES] : ""} {r.reference ?? ""}</div></>}</td>
              {showCost && <td className="small">{rs("carrierChargePaise" in r ? r.carrierChargePaise : null)}</td>}
              <td className="small">{RTO_STATE_LABEL[r.state] ?? r.state}{r.history.length > 0 && <div className="tiny muted">{r.history.length} change(s)</div>}</td>
              <td><ConfirmRto shipmentId={r.shipmentId} estimatePaise={r.finalChargePaise ?? r.rtoChargePaise} canWrite={canWrite} /></td>
            </tr>
          )) : <tr><td colSpan={8} className="muted small" style={{ padding: 16 }}>No RTO shipments with this status.</td></tr>}</tbody>
        </table>
      </div>
    </div>
  );
}
