import Link from "next/link";
import { redirect } from "next/navigation";
import { and, desc, eq } from "drizzle-orm";
import { StatusChip } from "@/lib/status";
import { audit } from "@/server/audit";
import { can } from "@/server/auth/rbac";
import { requireStaff } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { type CasePayload, markPushed, ndrCallCredits, ndrCallSettings, pushQueueCondition } from "@/server/ndr/service";
import { bolnaAccount } from "@/server/ndr/ai-call";

async function pushed(fd: FormData) {
  "use server";
  const s = await requireStaff("shipments.write");
  await markPushed(String(fd.get("id") ?? ""), s.userId);
  redirect("/admin/ndr/?queue=push");
}

async function saveCallPrice(fd: FormData) {
  "use server";
  const s = await requireStaff("notifications.write");
  const value = {
    pricePaise: Math.round(Math.max(1, Math.min(100, Number(fd.get("price")) || 8)) * 100),
    maxAttempts: Math.max(1, Math.min(3, Math.round(Number(fd.get("attempts")) || 2))),
    retryMinutes: Math.max(15, Math.min(720, Math.round(Number(fd.get("retry")) || 120))),
  };
  const db = await getDb();
  await db.insert(schema.pricingSettings).values({ key: "ndr_ai_call", value }).onConflictDoUpdate({ target: schema.pricingSettings.key, set: { value, updatedAt: new Date() } });
  await audit({ actorUserId: s.userId, actorKind: "staff", action: "ndr.ai_call_price", details: value });
  redirect("/admin/ndr/?saved=1");
}

const CALL: Record<string, string> = { queued: "queued", calling: "calling…", completed: "done", no_answer: "no answer", failed: "failed", skipped: "not made" };

export default async function AdminNdr({ searchParams }: { searchParams: Promise<{ kind?: string; queue?: string; saved?: string }> }) {
  const sp = await searchParams;
  const st = await requireStaff("shipments.read");
  const kind = sp.kind === "rto" ? "rto" : "ndr";
  const queue = sp.queue === "push";
  const db = await getDb();
  const rows = await db.select({ c: schema.ndrCases, s: schema.shipments, o: schema.orgs }).from(schema.ndrCases)
    .innerJoin(schema.shipments, eq(schema.shipments.id, schema.ndrCases.shipmentId)).innerJoin(schema.orgs, eq(schema.orgs.id, schema.ndrCases.orgId))
    .where(queue ? pushQueueCondition() : eq(schema.ndrCases.kind, kind)).orderBy(desc(schema.ndrCases.createdAt)).limit(300);
  const pending = (await db.select({ id: schema.ndrCases.id }).from(schema.ndrCases).where(pushQueueCondition()).limit(500)).length;
  const [cfg, credits, bolna] = await Promise.all([ndrCallSettings(), ndrCallCredits(), bolnaAccount()]);
  const write = can(st.role, "shipments.write");
  return (
    <>
      <div className="page-h"><h1>NDR / RTO</h1></div>
      <section className="card mb16" style={{ padding: 18 }}>
        <div className="row between wrap" style={{ gap: 12 }}>
          <div><b>AI NDR calling</b> <span className={`chip ${bolna ? "c-active" : "c-draft"}`}>{bolna ? "Bolna connected" : "Not connected"}</span>
            <p className="small muted" style={{ margin: "4px 0 0" }}>Clients switch it on from their NDR page. Connect Bolna in <Link className="link" href="/admin/services/">API Keys &amp; Services</Link>.</p></div>
          {can(st.role, "notifications.write") && (
            <form action={saveCallPrice} className="row wrap" style={{ gap: 8, alignItems: "end" }}>
              <div className="field"><label htmlFor="pr">Price per connected call (₹)</label><input id="pr" name="price" type="number" step="0.5" min="1" className="input" defaultValue={cfg.pricePaise / 100} style={{ width: 120 }} /></div>
              <div className="field"><label htmlFor="at">Calls per NDR</label><input id="at" name="attempts" type="number" min="1" max="3" className="input" defaultValue={cfg.maxAttempts} style={{ width: 90 }} /></div>
              <div className="field"><label htmlFor="rt">Retry after (min)</label><input id="rt" name="retry" type="number" min="15" max="720" className="input" defaultValue={cfg.retryMinutes} style={{ width: 110 }} /></div>
              <button className="btn btn-orange">Save</button>
            </form>
          )}
        </div>
        <p className="tiny muted" style={{ margin: "8px 0 0" }}>= {credits} credits per call at the current credit price. Charged only when the buyer picks up; credits are held when the call starts and given back if not connected.{sp.saved ? " Saved." : ""}</p>
      </section>
      <nav className="tabs">
        <Link href="/admin/ndr/" className={!queue && kind === "ndr" ? "on" : ""}>NDR</Link>
        <Link href="/admin/ndr/?kind=rto" className={!queue && kind === "rto" ? "on" : ""}>RTO</Link>
        <Link href="/admin/ndr/?queue=push" className={queue ? "on" : ""}>Push to courier{pending ? ` (${pending})` : ""}</Link>
      </nav>
      {queue && <p className="small muted mb12">Requests for couriers without an NDR API (or that refused it). Pass each one to the courier (panel, email or KAM), then mark it pushed — the client sees it as done.</p>}
      <div className="card p0 tbl-wrap"><table className="tbl"><thead><tr><th>Customer</th><th>AWB</th><th>Reason</th><th>Attempt</th><th>Deadline</th><th>Shipment</th><th>Case</th><th>AI call</th>{queue && write && <th />}</tr></thead>
        <tbody>{rows.length === 0 ? <tr><td colSpan={9} className="small muted">Nothing here.</td></tr> : rows.map(({ c, s, o }) => {
          const overdue = c.deadlineAt && c.deadlineAt.getTime() < Date.now() + 12 * 3600_000 && c.status === "open";
          const pl = (c.requestPayload ?? {}) as CasePayload;
          return <tr key={c.id}><td className="small">{o.businessName}</td><td><Link className="mono tiny link-navy" href={`/admin/shipments/${s.id}/`}>{s.awb}</Link><div className="tiny muted">{s.carrierName}</div></td><td className="small">{c.reason}</td><td>{c.attempt}</td><td className={overdue ? "small err" : "small"}>{c.deadlineAt?.toLocaleString("en-IN") ?? "—"}</td><td><StatusChip status={s.status} /></td>
            <td className="small">{c.status}{c.requestedAction ? ` · ${c.requestedAction}` : ""}{pl.source ? <div className="tiny muted">by {pl.source.replace("_", " ")}{pl.manual ? " · manual push" : ""}</div> : null}{pl.line1 ? <div className="tiny muted">New address: {pl.line1}</div> : null}</td>
            <td className="small">{pl.aiCall ? <>{CALL[pl.aiCall.state] ?? pl.aiCall.state}{pl.aiCall.outcome ? ` · ${pl.aiCall.outcome}` : ""}{pl.aiCall.preferredDate ? <div className="tiny muted">{pl.aiCall.preferredDate}</div> : null}</> : "—"}</td>
            {queue && write && <td><form action={pushed}><input type="hidden" name="id" value={c.id} /><button className="btn btn-sm btn-navy">Mark pushed</button></form></td>}</tr>;
        })}</tbody></table></div>
    </>
  );
}
