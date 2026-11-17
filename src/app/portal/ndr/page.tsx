import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { NdrActions } from "@/components/portal/NdrActions";
import { carrierLogo } from "@/lib/site";
import { StatusChip } from "@/lib/status";
import { getDb, schema } from "@/server/db/client";
import { portalContext } from "@/server/portal/context";

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
  return (
    <>
      <div className="page-h"><h1>NDR &amp; RTO</h1></div>
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
            <thead><tr><th>Order / AWB</th><th>Courier</th><th>Reason</th><th>Attempt</th><th>Deadline</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>
              {filtered.map(({ c, s, o }) => (
                <tr key={c.id}>
                  <td><Link className="b link-navy" href={`/portal/orders/${o.id}/`}>{o.orderNumber}</Link><div className="tiny mono muted">{s.awb}</div></td>
                  <td>{carrierLogo(s.carrierCode) ? <img className="clogo-sm" src={carrierLogo(s.carrierCode)!} alt={s.carrierName} /> : s.carrierName}</td>
                  <td className="small">{c.reason ?? "—"}</td>
                  <td>{c.attempt}</td>
                  <td className="small">{c.deadlineAt ? c.deadlineAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—"}</td>
                  <td><StatusChip status={s.status} /><div className="tiny muted">{c.status.replace("_", " ")}{c.requestedAction ? ` · ${c.requestedAction.replace("_", " ")}` : ""}</div></td>
                  <td>{tab === "ndr" && c.status === "open" ? <NdrActions caseId={c.id} /> : <span className="tiny muted">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
