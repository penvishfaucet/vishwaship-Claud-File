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

type Ev = { label: string; url?: string; urls?: string[]; note?: string; by?: string; claimedGrams?: number };
type Calc = { before?: { total: number }; after?: { total: number }; fod?: boolean; receiverBeforePaise?: number; receiverAfterPaise?: number } | null;

export default async function WeightDiscrepancyPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const sp = await searchParams;
  const ctx = await portalContext();
  const db = await getDb();
  const all = await db.select({ w: schema.weightDisputes, s: schema.shipments, o: schema.orders }).from(schema.weightDisputes)
    .innerJoin(schema.shipments, eq(schema.shipments.id, schema.weightDisputes.shipmentId)).innerJoin(schema.orders, eq(schema.orders.id, schema.shipments.orderId))
    .where(eq(schema.weightDisputes.orgId, ctx.org.id)).orderBy(desc(schema.weightDisputes.createdAt)).limit(500);
  const pk = all.length ? await db.select().from(schema.packages).where(inArray(schema.packages.orderId, all.map((r) => r.o.id))) : [];
  const now = new Date();

  // Everything each row / card shows, worked out once.
  const items = all.filter((r) => !sp.status || r.w.status === sp.status).map(({ w, s, o }) => {
    const boxes = pk.filter((p) => p.orderId === o.id);
    const actual = boxes.reduce((t, b) => t + b.actualWeightGrams * b.count, 0);
    const vol = boxes.reduce((t, b) => t + Math.ceil((b.lengthMm * b.breadthMm * b.heightMm) / 1000 / 5000 * 1000) * b.count, 0);
    const ev = w.evidence as Ev[];
    const c = w.calc as Calc;
    const fodInfo = !!c?.fod && w.chargePaise === 0;
    const [label, chip] = fodInfo && w.status === "open" ? ["FoD — receiver pays", "c-pending"] : fodInfo && w.status === "accepted" ? ["FoD — closed", "c-draft"] : STATUS[w.status] ?? [w.status, "c-draft"];
    const open = w.status === "open" && w.deadlineAt > now;
    const due = w.status === "open" ? (open ? `Dispute by ${w.deadlineAt.toLocaleDateString("en-IN")}${fodInfo ? " if the courier weight is wrong" : " — otherwise charged to wallet"}` : "Dispute window closed") : null;
    const charge = fodInfo ? "No charge" : formatINR(w.chargePaise);
    const chargeNote = c?.fod ? `FoD: receiver pays ${formatINR(c.receiverBeforePaise ?? 0)} → ${formatINR(c.receiverAfterPaise ?? 0)} at delivery` : c?.before && c.after ? `${formatINR(c.before.total)} → ${formatINR(c.after.total)} incl. GST` : null;
    const evidence = ev.length ? ev.map((e, i) => (
      <div key={i}>{e.url ? <a className="link" href={e.url} target="_blank" rel="noreferrer">{e.label}</a> : e.label}{e.by === "seller" && e.claimedGrams ? ` (you: ${kg(e.claimedGrams)})` : ""}{e.urls?.map((u, j) => <a key={j} className="link" href={u} target="_blank" rel="noreferrer" style={{ marginLeft: 4 }}>[{j + 1}]</a>)}</div>
    )) : "—";
    const form = (m: string) => (open ? <DisputeForm id={w.id} idSuffix={m} declaredKg={Number(((actual || w.declaredGrams) / 1000).toFixed(2))} /> : null);
    return { w, s, o, fodInfo, actual, vol, label, chip, due, charge, chargeNote, evidence, form };
  });

  return (
    <>
      <div className="page-h"><div><h1>Weight Discrepancy</h1>
        <p className="small muted" style={{ margin: "4px 0 0" }}>When the courier’s measured weight is higher than what you booked, it appears here (you also get an email). Extra charge = your same rate for the courier’s weight minus what you paid at booking, plus GST. Not disputed within 7 days → debited from your wallet. FoD (freight on delivery): nothing is charged to you — the receiver pays at delivery.</p>
      </div></div>
      <nav className="pills mb12 wd-pills" aria-label="Status">
        <Link className={!sp.status ? "pill on" : "pill"} href="/portal/tools/weight-discrepancy/">All {all.length}</Link>
        {Object.entries(STATUS).map(([k, [l]]) => <Link key={k} className={sp.status === k ? "pill on" : "pill"} href={`/portal/tools/weight-discrepancy/?status=${k}`}>{l} {all.filter((r) => r.w.status === k).length}</Link>)}
      </nav>
      {items.length === 0 ? <div className="card empty"><p className="muted">{all.length ? "Nothing with this status." : "No weight discrepancies. Accurate weights and box sizes keep it that way."}</p></div> : (
        <>
          {/* Desktop / tablet: table */}
          <div className="card p0 tbl-wrap only-desktop"><table className="tbl">
            <thead><tr><th>Order / AWB</th><th>Entered actual</th><th>Volumetric</th><th>Booked chargeable</th><th>Carrier weight</th><th>Revised chargeable</th><th>Extra charge</th><th>Evidence</th><th>Status / action</th></tr></thead>
            <tbody>{items.map((x) => (
              <tr key={x.w.id}>
                <td className="small"><OrderIdLink value={x.o.orderNumber} href={portalOrderHref(x.o.id)} /><div className="tiny id-row"><AwbLink value={x.s.awb} href={portalTrackHref(x.s.awb)} />{x.s.awb && <CopyBtn value={x.s.awb} label="AWB" />}</div><div className="tiny muted">{x.s.carrierName}</div></td>
                <td className="small">{kg(x.actual || x.w.declaredGrams)}</td>
                <td className="small">{x.vol ? kg(x.vol) : "—"}<div className="tiny muted">÷ 5000</div></td>
                <td className="small">{kg(x.s.chargeableWeightGrams)}</td>
                <td className="small b">{kg(x.w.carrierGrams)}</td>
                <td className="small">{kg(x.w.revisedChargeableGrams)}</td>
                <td className={`small b ${x.fodInfo ? "green" : "t-debit"}`}>{x.charge}{x.chargeNote && <div className="tiny muted" style={{ fontWeight: 400 }}>{x.chargeNote}</div>}</td>
                <td className="tiny">{x.evidence}</td>
                <td className="small">
                  <span className={`chip ${x.chip}`}>{x.label}</span>
                  {x.w.resolution && <div className="tiny muted">{x.w.resolution}</div>}
                  {x.due && <div className="tiny muted">{x.due}</div>}
                  {x.form("") && <div className="mt8">{x.form("")}</div>}
                </td>
              </tr>
            ))}</tbody>
          </table></div>

          {/* Phone: one card per shipment, nothing hidden */}
          <div className="only-mobile wd-cards">
            {items.map((x) => (
              <article key={x.w.id} className="card wd-card">
                <div className="wd-card-h">
                  <div className="wd-ids">
                    <OrderIdLink value={x.o.orderNumber} href={portalOrderHref(x.o.id)} />
                    <div className="tiny id-row"><AwbLink value={x.s.awb} href={portalTrackHref(x.s.awb)} />{x.s.awb && <CopyBtn value={x.s.awb} label="AWB" />}</div>
                    <div className="tiny muted">{x.s.carrierName}</div>
                  </div>
                  <span className={`chip ${x.chip}`}>{x.label}</span>
                </div>
                <dl className="wd-grid">
                  <div><dt>Entered actual</dt><dd>{kg(x.actual || x.w.declaredGrams)}</dd></div>
                  <div><dt>Volumetric (÷ 5000)</dt><dd>{x.vol ? kg(x.vol) : "—"}</dd></div>
                  <div><dt>Booked chargeable</dt><dd>{kg(x.s.chargeableWeightGrams)}</dd></div>
                  <div><dt>Courier weight</dt><dd className="b">{kg(x.w.carrierGrams)}</dd></div>
                  <div className="wd-full"><dt>Extra charge</dt><dd className={`b ${x.fodInfo ? "green" : "t-debit"}`}>{x.charge}{x.chargeNote && <div className="tiny muted" style={{ fontWeight: 400 }}>{x.chargeNote}</div>}</dd></div>
                  <div className="wd-full"><dt>Evidence</dt><dd className="tiny">{x.evidence}</dd></div>
                </dl>
                {x.w.resolution && <p className="tiny muted" style={{ margin: "6px 0 0" }}>{x.w.resolution}</p>}
                {x.due && <p className="tiny muted" style={{ margin: "6px 0 0" }}>{x.due}</p>}
                {x.form("-m") && <div className="mt8 wd-form">{x.form("-m")}</div>}
              </article>
            ))}
          </div>
        </>
      )}
    </>
  );
}
