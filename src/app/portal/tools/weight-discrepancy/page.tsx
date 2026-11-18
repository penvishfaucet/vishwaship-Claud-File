import { CopyBtn } from "@/components/portal/orders/ui";
import { AwbLink, OrderIdLink, portalOrderHref, portalTrackHref } from "@/components/IdLinks";
import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { DisputeForm } from "@/components/portal/DisputeForm";
import { formatINR } from "@/lib/money";
import { getDb, schema } from "@/server/db/client";
import { portalContext } from "@/server/portal/context";

const kg = (g: number) => `${(g / 1000).toFixed(2)} kg`;
const STATUS: Record<string, [string, string]> = { open: ["Action needed", "c-pending"], disputed: ["Under review", "c-pending"], accepted: ["Accepted", "c-draft"], waived: ["Waived — no charge", "c-active"], charged: ["Charged", "c-failed"] };

export default async function WeightDiscrepancyPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const sp = await searchParams;
  const ctx = await portalContext();
  const db = await getDb();
  const all = await db.select({ w: schema.weightDisputes, s: schema.shipments, o: schema.orders }).from(schema.weightDisputes)
    .innerJoin(schema.shipments, eq(schema.shipments.id, schema.weightDisputes.shipmentId)).innerJoin(schema.orders, eq(schema.orders.id, schema.shipments.orderId))
    .where(eq(schema.weightDisputes.orgId, ctx.org.id)).orderBy(desc(schema.weightDisputes.createdAt)).limit(500);
  const pk = all.length ? await db.select().from(schema.packages).where(inArray(schema.packages.orderId, all.map((r) => r.o.id))) : [];
  const rows = all.filter((r) => !sp.status || r.w.status === sp.status);
  const now = new Date();
  return (
    <>
      <div className="page-h"><div><h1>Weight Discrepancy</h1><p className="small muted" style={{ margin: "4px 0 0" }}>When the courier’s measured weight is higher than what you booked, the extra charge appears here. Dispute it with photos before the deadline.</p></div></div>
      <nav className="pills mb12" aria-label="Status">
        <Link className={!sp.status ? "pill on" : "pill"} href="/portal/tools/weight-discrepancy/">All {all.length}</Link>
        {Object.entries(STATUS).map(([k, [l]]) => <Link key={k} className={sp.status === k ? "pill on" : "pill"} href={`/portal/tools/weight-discrepancy/?status=${k}`}>{l} {all.filter((r) => r.w.status === k).length}</Link>)}
      </nav>
      {rows.length === 0 ? <div className="card empty"><p className="muted">{all.length ? "Nothing with this status." : "No weight discrepancies. Accurate weights and box sizes keep it that way."}</p></div> : (
        <div className="card p0 tbl-wrap"><table className="tbl">
          <thead><tr><th>Order / AWB</th><th>Entered actual</th><th>Volumetric</th><th>Booked chargeable</th><th>Carrier weight</th><th>Revised chargeable</th><th>Extra charge</th><th>Evidence</th><th>Status / action</th></tr></thead>
          <tbody>{rows.map(({ w, s, o }) => {
            const boxes = pk.filter((p) => p.orderId === o.id);
            const actual = boxes.reduce((t, b) => t + b.actualWeightGrams * b.count, 0);
            const vol = boxes.reduce((t, b) => t + Math.ceil((b.lengthMm * b.breadthMm * b.heightMm) / 1000 / 5000 * 1000) * b.count, 0);
            const ev = w.evidence as Array<{ label: string; url?: string; urls?: string[]; note?: string; by?: string; claimedGrams?: number }>;
            const [label, chip] = STATUS[w.status] ?? [w.status, "c-draft"];
            const open = w.status === "open" && w.deadlineAt > now;
            return (
              <tr key={w.id}>
                <td className="small"><OrderIdLink value={o.orderNumber} href={portalOrderHref(o.id)} /><div className="tiny id-row"><AwbLink value={s.awb} href={portalTrackHref(s.awb)} />{s.awb && <CopyBtn value={s.awb} label="AWB" />}</div><div className="tiny muted">{s.carrierName}</div></td>
                <td className="small">{kg(actual || w.declaredGrams)}</td>
                <td className="small">{vol ? kg(vol) : "—"}<div className="tiny muted">÷ 5000</div></td>
                <td className="small">{kg(s.chargeableWeightGrams)}</td>
                <td className="small b">{kg(w.carrierGrams)}</td>
                <td className="small">{kg(w.revisedChargeableGrams)}</td>
                <td className="small b t-debit">{formatINR(w.chargePaise)}</td>
                <td className="tiny">{ev.length ? ev.map((e, i) => <div key={i}>{e.url ? <a className="link" href={e.url} target="_blank" rel="noreferrer">{e.label}</a> : e.label}{e.by === "seller" && e.claimedGrams ? ` (you: ${kg(e.claimedGrams)})` : ""}{e.urls?.map((u, j) => <a key={j} className="link" href={u} target="_blank" rel="noreferrer" style={{ marginLeft: 4 }}>[{j + 1}]</a>)}</div>) : "—"}</td>
                <td className="small">
                  <span className={`chip ${chip}`}>{label}</span>
                  {w.resolution && <div className="tiny muted">{w.resolution}</div>}
                  {w.status === "open" && <div className="tiny muted">{open ? `Dispute by ${w.deadlineAt.toLocaleDateString("en-IN")}` : "Dispute window closed"}</div>}
                  {open && <div className="mt8"><DisputeForm id={w.id} declaredKg={Number(((actual || w.declaredGrams) / 1000).toFixed(2))} /></div>}
                </td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
    </>
  );
}
