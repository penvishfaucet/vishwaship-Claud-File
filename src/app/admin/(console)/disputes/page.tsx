import { desc, eq } from "drizzle-orm";
import { formatINR } from "@/lib/money";
import { DisputeButtons } from "@/components/admin/DisputeButtons";
import { WeightImport } from "@/components/admin/WeightImport";
import { CourierMailSettings } from "@/components/admin/CourierMailSettings";
import { courierMailSettings } from "@/server/weight/courier-dispute";
import { can } from "@/server/auth/rbac";
import { requireStaff } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { inboundSecret, recentCourierMails } from "@/server/weight/inbound-mail";

export default async function Disputes() {
  const s = await requireStaff("shipments.read");
  const db = await getDb();
  const rows = await db.select({ d: schema.weightDisputes, sh: schema.shipments, o: schema.orgs }).from(schema.weightDisputes)
    .innerJoin(schema.shipments, eq(schema.shipments.id, schema.weightDisputes.shipmentId)).innerJoin(schema.orgs, eq(schema.orgs.id, schema.weightDisputes.orgId)).orderBy(desc(schema.weightDisputes.createdAt));
  const fin = can(s.role, "finance.adjust");
  const [mails, auto] = fin ? await Promise.all([recentCourierMails(), inboundSecret().then(Boolean)]) : [[], false];
  const cmail = fin ? await courierMailSettings() : { to: [], cc: [] };
  return (
    <>
      <div className="page-h"><div><h1>Weight Disputes</h1><p className="small muted" style={{ margin: "4px 0 0" }}>Courier weight above the booked chargeable weight is passed on to the client: re-rated at the booking rate with the same markup, plus GST. Clients get 7 days to dispute; undisputed ones are debited automatically.</p></div></div>
      {fin && <CourierMailSettings to={cmail.to.join(", ")} cc={cmail.cc.join(", ")} />}
      {fin && <WeightImport />}
      {fin && (
        <div className="card mb12">
          <h2 className="h3" style={{ marginTop: 0 }}>Courier mails received (automatic)</h2>
          <p className="small muted" style={{ margin: "0 0 8px" }}>{auto ? "ON — courier weight-discrepancy mails forwarded to noreply@vishwaship.com are read automatically: the discrepancy is raised and the client is told by portal alert and email." : "OFF — set it up once in Admin → API Keys & Services → Resend (steps are on that page). Until then, paste the mail above."}</p>
          {mails.length === 0 ? <p className="small muted">No courier mails received yet.</p> : (
            <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Received</th><th>From / subject</th><th>Result</th></tr></thead>
              <tbody>{mails.map((m) => { const p = m.payloadRedacted as { from?: string; subject?: string; status?: string; result?: string; preview?: string }; return (
                <tr key={m.id}><td className="small">{m.createdAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                  <td className="small">{p.from}<div className="tiny muted">{p.subject}</div></td>
                  <td className="tiny"><span className={`chip ${p.status === "raised" ? "c-active" : p.status === "error" ? "c-failed" : "c-draft"}`}>{p.status ?? "processing"}</span><div className="muted">{p.result}</div>{p.preview && <details><summary className="link">Mail text</summary><pre className="tiny" style={{ whiteSpace: "pre-wrap", maxWidth: 520 }}>{p.preview}</pre></details>}</td></tr>); })}</tbody>
            </table></div>
          )}
        </div>
      )}
      <div className="card p0 tbl-wrap only-desktop"><table className="tbl"><thead><tr><th>Customer</th><th>AWB</th><th>Declared</th><th>Carrier</th><th>Revised</th><th>Charge</th><th>Courier extra</th><th>Deadline</th><th>Status</th><th /></tr></thead>
        <tbody>{rows.map(({ d, sh, o }) => (
          <tr key={d.id}><td className="small">{o.businessName}</td><td className="mono tiny">{sh.awb}</td><td>{d.declaredGrams / 1000} kg</td><td>{d.carrierGrams / 1000} kg</td><td>{d.revisedChargeableGrams / 1000} kg</td><td>{formatINR(d.chargePaise)}<div className="tiny muted">{d.source}</div></td><td className="small">{(() => { const c = d.calc as { extraCostPreTax?: number; basis?: string } | null; return c?.extraCostPreTax != null ? <>{formatINR(c.extraCostPreTax)}<div className="tiny muted">{c.basis === "courier" ? "from report" : "re-rated"} · pre-GST</div></> : "—"; })()}</td><td className="small">{d.deadlineAt.toLocaleDateString("en-IN")}</td><td><span className={`chip ${d.status === "disputed" ? "c-failed" : d.status === "open" ? "c-active" : "c-draft"}`}>{d.status === "disputed" ? "● client disputed" : d.status === "open" ? "● open" : d.status}</span>{(d.evidence as Array<{ by?: string; note?: string; claimedGrams?: number; urls?: string[] }>).filter((e) => e.by === "seller").map((e, i) => <div key={i} className="tiny" style={{ maxWidth: 260 }}><b>Seller:</b> {e.claimedGrams ? `${e.claimedGrams / 1000} kg — ` : ""}{e.note}{e.urls?.map((u, j) => <a key={j} className="link" href={u} target="_blank" rel="noreferrer noopener" style={{ marginLeft: 4 }}>[{j + 1}]</a>)}</div>)}</td>
            <td>{fin && d.status !== "waived" && <DisputeButtons id={d.id} status={d.status} fod={!!(d.calc as { fod?: boolean } | null)?.fod && d.chargePaise === 0} courier={sh.carrierName} canSend={cmail.to.length > 0} sentAt={[...(d.evidence as Array<{ by?: string; at?: string }>)].reverse().find((e) => e.by === "vishwaship")?.at ?? null} />}</td></tr>
        ))}</tbody></table></div>
      {/* Phone: one card per discrepancy */}
      <div className="wd-cards" style={{ marginTop: -8 }}>
        {rows.map(({ d, sh, o }) => {
          const c = d.calc as { extraCostPreTax?: number; basis?: string; fod?: boolean } | null;
          const seller = (d.evidence as Array<{ by?: string; note?: string; claimedGrams?: number; urls?: string[] }>).filter((e) => e.by === "seller");
          return (
            <article key={d.id} className="card wd-card">
              <div className="wd-card-h">
                <div className="wd-ids"><b className="small">{o.businessName}</b><div className="mono tiny">LR / AWB {sh.lrNumber ?? sh.awb ?? "—"}</div><div className="tiny muted">{sh.carrierName}{c?.fod ? " · FoD" : ""}</div></div>
                <span className={`chip ${d.status === "disputed" ? "c-failed" : d.status === "open" ? "c-active" : "c-draft"}`}>{d.status === "disputed" ? "● client disputed" : d.status === "open" ? "● open" : d.status}</span>
              </div>
              <dl className="wd-grid">
                <div><dt>Booked</dt><dd>{d.declaredGrams / 1000} kg</dd></div>
                <div><dt>Courier</dt><dd className="b">{d.carrierGrams / 1000} kg</dd></div>
                <div><dt>Client charge</dt><dd className="b">{c?.fod && d.chargePaise === 0 ? "No charge (FoD)" : formatINR(d.chargePaise)}</dd></div>
                <div><dt>Courier extra (pre-GST)</dt><dd>{c?.extraCostPreTax != null ? formatINR(c.extraCostPreTax) : "—"}</dd></div>
                <div><dt>Dispute deadline</dt><dd>{d.deadlineAt.toLocaleDateString("en-IN")}</dd></div>
                <div><dt>Source</dt><dd>{d.source}</dd></div>
                {seller.length > 0 && <div className="wd-full"><dt>Client says</dt><dd className="tiny">{seller.map((e, i) => <div key={i}>{e.claimedGrams ? `${e.claimedGrams / 1000} kg — ` : ""}{e.note}{e.urls?.map((u, j) => <a key={j} className="link" href={u} target="_blank" rel="noreferrer noopener" style={{ marginLeft: 4 }}>[photo {j + 1}]</a>)}</div>)}</dd></div>}
                {d.resolution && <div className="wd-full"><dt>Result</dt><dd className="tiny">{d.resolution}</dd></div>}
              </dl>
              {fin && d.status !== "waived" && <div className="wd-actions"><DisputeButtons id={d.id} status={d.status} fod={!!c?.fod && d.chargePaise === 0} courier={sh.carrierName} canSend={cmail.to.length > 0} sentAt={[...(d.evidence as Array<{ by?: string; at?: string }>)].reverse().find((e) => e.by === "vishwaship")?.at ?? null} /></div>}
            </article>
          );
        })}
      </div>
    </>
  );
}
