import { CopyBtn } from "@/components/portal/orders/ui";
import { AwbLink, OrderIdLink, portalOrderHref, portalTrackHref } from "@/components/IdLinks";
import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { NdrActions } from "@/components/portal/NdrActions";
import { carrierLogo } from "@/lib/site";
import { StatusChip } from "@/lib/status";
import { getDb, schema } from "@/server/db/client";
import { portalContext } from "@/server/portal/context";
import { NdrAiCalling } from "@/components/portal/NdrAiCalling";
import { aiCallingEnabled, ndrCallCredits, ndrCallSettings, type CasePayload } from "@/server/ndr/service";
import { bolnaAccount } from "@/server/ndr/ai-call";

const CALL_TEXT: Record<string, string> = { queued: "AI call queued", calling: "AI calling the buyer…", completed: "AI call done", no_answer: "Buyer did not pick up", failed: "AI call failed", skipped: "AI call not made" };
const OUTCOME: Record<string, string> = { reattempt: "Buyer wants the parcel", rto: "Buyer does not want it", unclear: "Answer unclear" };

export default async function NdrPage({ searchParams }: { searchParams: Promise<{ tab?: string; status?: string }> }) {
  const sp = await searchParams;
  const tab = sp.tab === "rto" ? "rto" : "ndr";
  const ctx = await portalContext();
  const db = await getDb();
  const rows = await db.select({ c: schema.ndrCases, s: schema.shipments, o: schema.orders }).from(schema.ndrCases)
    .innerJoin(schema.shipments, eq(schema.shipments.id, schema.ndrCases.shipmentId))
    .innerJoin(schema.orders, eq(schema.orders.id, schema.shipments.orderId))
    .where(and(eq(schema.ndrCases.orgId, ctx.org.id), eq(schema.ndrCases.kind, tab))).orderBy(desc(schema.ndrCases.createdAt));
  const filtered = sp.status ? rows.filter((r) => r.c.status === sp.status) : rows;
  const counts = rows.reduce<Record<string, number>>((m, r) => ({ ...m, [r.c.status]: (m[r.c.status] ?? 0) + 1 }), {});
  const [aiOn, callCfg, callCredits, bolna] = await Promise.all([aiCallingEnabled(ctx.org.id), ndrCallSettings(), ndrCallCredits(), bolnaAccount()]);
  return (
    <>
      <div className="page-h"><div><h1>NDR</h1><p className="small muted" style={{ margin: "4px 0 0" }}>Failed deliveries and RTO — act before the courier deadline.</p></div></div>
      <NdrAiCalling enabled={aiOn} priceRupees={callCfg.pricePaise / 100} credits={callCredits} balance={ctx.credits} live={!!bolna} />
      <nav className="tabs" aria-label="Queue">
        <Link href="/portal/ndr/?tab=ndr" className={tab === "ndr" ? "on" : ""}>NDR</Link>
        <Link href="/portal/ndr/?tab=rto" className={tab === "rto" ? "on" : ""}>RTO</Link>
      </nav>
      <div className="pills mb12">
        <Link className={!sp.status ? "pill on" : "pill"} href={`/portal/ndr/?tab=${tab}`}>All {rows.length}</Link>
        {["open", "action_requested", "acknowledged", "closed"].map((s) => <Link key={s} className={sp.status === s ? "pill on" : "pill"} href={`/portal/ndr/?tab=${tab}&status=${s}`}>{s.replace("_", " ")} {counts[s] ?? 0}</Link>)}
      </div>
      {filtered.length === 0 ? <div className="card empty"><p className="muted">Nothing in this queue.</p></div> : (
        <div className="card p0 tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Order / AWB</th><th>Courier</th><th>Reason</th><th>Attempt</th><th>Deadline</th><th>Status</th><th>AI call</th><th>Action</th></tr></thead>
            <tbody>
              {filtered.map(({ c, s, o }) => (
                <tr key={c.id}>
                  <td><OrderIdLink value={o.orderNumber} href={portalOrderHref(o.id)} /><div className="tiny id-row"><AwbLink value={s.awb} href={portalTrackHref(s.awb)} />{s.awb && <CopyBtn value={s.awb} label="AWB" />}</div></td>
                  <td>{carrierLogo(s.carrierCode) ? <img className="clogo-sm" src={carrierLogo(s.carrierCode)!} alt={s.carrierName} /> : s.carrierName}</td>
                  <td className="small">{c.reason ?? "—"}</td>
                  <td>{c.attempt}</td>
                  <td className="small">{c.deadlineAt ? c.deadlineAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                  <td><StatusChip status={s.status} /><div className="tiny muted">{c.status.replace("_", " ")}{c.requestedAction ? ` · ${c.requestedAction.replace("_", " ")}` : ""}</div></td>
                  <td className="small">{(() => { const pl = (c.requestPayload ?? {}) as CasePayload; const a = pl.aiCall; return a ? <><b>{a.state === "completed" && a.outcome ? OUTCOME[a.outcome] : CALL_TEXT[a.state]}</b>{a.preferredDate && <div className="tiny muted">Preferred: {a.preferredDate}</div>}{a.note && a.state !== "completed" && <div className="tiny muted">{a.note}</div>}{(a.credits ?? 0) > 0 && a.state === "completed" && <div className="tiny muted">{a.credits} credits</div>}</> : <span className="tiny muted">—</span>; })()}</td>
                  <td>{tab === "ndr" && c.status === "open" ? <NdrActions caseId={c.id} /> : c.status === "action_requested" && ((c.requestPayload ?? {}) as CasePayload).manual ? <span className="tiny">Vishwaship is passing it to the courier</span> : <span className="tiny muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
