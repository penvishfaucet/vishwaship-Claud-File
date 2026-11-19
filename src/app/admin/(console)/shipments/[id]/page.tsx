import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, desc, eq } from "drizzle-orm";
import { formatINR } from "@/lib/money";
import { StatusChip, statusLabel } from "@/lib/status";
import { can } from "@/server/auth/rbac";
import { requireStaff } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { LabelDownload } from "@/components/labels/LabelDownload";
import { labelFormatsFor } from "@/server/labels/formats";

export default async function AdminShipment({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireStaff("shipments.read");
  const db = await getDb();
  const [row] = await db.select({ s: schema.shipments, o: schema.orders, org: schema.orgs }).from(schema.shipments)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.shipments.orderId)).innerJoin(schema.orgs, eq(schema.orgs.id, schema.shipments.orgId)).where(eq(schema.shipments.id, id));
  if (!row) notFound();
  const { s: x, o, org } = row;
  const events = await db.select().from(schema.shipmentEvents).where(eq(schema.shipmentEvents.shipmentId, id)).orderBy(desc(schema.shipmentEvents.occurredAt));
  const pkgs = await db.select().from(schema.packages).where(eq(schema.packages.orderId, o.id));
  const [q] = await db.select().from(schema.quotes).where(eq(schema.quotes.id, x.quoteId));
  const priced = q?.priced as {
    markup?: { bps: number; source: string; ruleVersion: number }; costPreTax?: number; sellingSubtotal?: number; gst?: number; total?: number; pending?: string;
    providerComponents?: Array<{ code: string; label: string; amount: number }>; providerTaxInclusive?: boolean; providerQuoteRef?: string; chargeableWeightGrams?: number;
    lines?: Array<{ code: string; label: string; costPreTax: number; sellPreTax: number; markupEligible: boolean }>; payer?: { sender: number; receiver: number };
  } | undefined;
  const qreq = q?.request as { originPincode?: string; destinationPincode?: string; paymentType?: string; packages?: Array<{ count: number; lengthMm: number; breadthMm: number; heightMm: number; actualWeightGrams: number }> } | undefined;
  const showCost = can(s.role, "shipments.cost.read");
  const [cu] = await db.select({ email: schema.users.email }).from(schema.users).where(and(eq(schema.users.orgId, org.id), eq(schema.users.kind, "customer"))).orderBy(asc(schema.users.createdAt)).limit(1);
  const clientEmail = cu?.email ?? null;
  return (
    <>
      <div className="page-h">
        <div><Link className="small link-navy" href={`/admin/customers/${org.id}/`}>{org.businessName}</Link><h1>{o.orderNumber} <span className="mono small muted">{x.awb}</span></h1></div>
        <div className="actions"><StatusChip status={x.status} />{x.provider === "demo" && <span className="demo-badge">DEMO</span>}</div>
      </div>
      {x.status !== "cancelled" && (
        <section className="card mb12" style={{ padding: 14 }} aria-label="Label">
          <h2 className="b small" style={{ marginTop: 0 }}>Label</h2>
          {x.awb ? <LabelDownload ids={[x.id]} api="/api/admin/labels" formats={labelFormatsFor(x.provider)} /> : <p className="small muted" style={{ margin: 0 }}>Label pending — the courier has not assigned the AWB / LRN yet.</p>}
        </section>
      )}
      <div className="split-2-1" style={{ alignItems: "start" }}>
        <section className="card" style={{ padding: 16 }}>
          <h2 className="b small" style={{ marginTop: 0 }}>Operations</h2>
          <dl className="kv-list">
            <dt>Booking provider</dt><dd>{x.provider} ({x.providerAccountId})</dd><dt>Actual carrier</dt><dd>{x.carrierName} · {x.serviceName}</dd>
            <dt>Provider ref</dt><dd className="mono">{x.providerOrderRef ?? "—"}</dd><dt>LR / pieces</dt><dd className="mono">{x.lrNumber ?? "—"}{x.pieceIds ? ` · ${(x.pieceIds as string[]).length} pieces` : ""}</dd>
            <dt>Booking / pickup / label</dt><dd>{x.bookingStatus} / {x.pickupStatus} / {x.labelStatus}</dd>
            <dt>Boxes</dt><dd>{pkgs.reduce((t, p) => t + p.count, 0)}</dd><dt>Chargeable / carrier wt</dt><dd>{(x.chargeableWeightGrams / 1000).toFixed(2)} kg / {x.carrierWeightGrams ? `${(x.carrierWeightGrams / 1000).toFixed(2)} kg` : "—"}</dd>
          </dl>
        </section>
        <section className="card" style={{ padding: 16 }}>
          <h2 className="b small" style={{ marginTop: 0 }}>Finance</h2>
          <dl className="kv-list">
            <dt>Customer total (incl. GST)</dt><dd>{formatINR(q?.totalPaise ?? x.sellPaise)}</dd>
            {o.paymentType === "fod" && <><dt>Charged to sender wallet</dt><dd>{formatINR(x.sellPaise)}</dd><dt>FOD from receiver</dt><dd>{formatINR(x.receiverFreightPaise ?? 0)}</dd></>}
            {showCost ? <>
              <dt>Carrier cost (pre-tax)</dt><dd>{formatINR(x.costPaise)}</dd>
              <dt>Markup applied</dt><dd>{priced?.markup ? `${priced.markup.bps / 100}% (${priced.markup.source}, v${priced.markup.ruleVersion})` : "—"}</dd>
              <dt>Margin (pre-tax)</dt><dd>{priced?.sellingSubtotal !== undefined ? formatINR(priced.sellingSubtotal - x.costPaise) : "—"}</dd>
            </> : <><dt>Cost &amp; margin</dt><dd className="muted">Restricted</dd></>}
            <dt>Vishwaship Client Email</dt><dd>{clientEmail ?? "—"}</dd>
            <dt>Recipient Email (Optional)</dt><dd>{(o.consignee as { email?: string }).email || "—"}</dd>
            <dt>Payment</dt><dd>{o.paymentType === "cod" ? `COD ${formatINR(o.codAmountPaise)}` : o.paymentType === "fod" ? "FOD (freight on delivery)" : "Prepaid"}</dd>
            {showCost && x.carrierChargePaise != null && <><dt>Carrier-confirmed charge</dt><dd className={x.chargeCheck === "higher" ? "t-bad" : undefined}>{formatINR(x.carrierChargePaise)}{x.chargeCheck === "higher" ? " — above quote" : ""}</dd></>}
          </dl>
        </section>
      </div>
      {showCost && q && (
        <section className="card mt16" style={{ padding: 16 }} aria-labelledby="qb-h">
          <h2 id="qb-h" className="b small" style={{ marginTop: 0 }}>Quote used for this booking — exactly as the courier returned it</h2>
          <p className="small muted" style={{ margin: "0 0 8px" }}>
            {q.id} · {q.createdAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} · source {priced?.providerQuoteRef ?? "—"} · {qreq?.originPincode} → {qreq?.destinationPincode} · {qreq?.paymentType?.toUpperCase()} ·
            {" "}chargeable {priced?.chargeableWeightGrams ? `${(priced.chargeableWeightGrams / 1000).toFixed(1)} kg` : "—"}
            {qreq?.packages?.length ? ` · ${qreq.packages.map((k) => `${k.count}× ${k.lengthMm / 10}×${k.breadthMm / 10}×${k.heightMm / 10} cm ${k.actualWeightGrams / 1000} kg`).join(", ")}` : ""}
            {priced?.providerTaxInclusive ? " · courier amounts include GST" : " · courier amounts before GST"}
          </p>
          {priced?.pending && <p className="small t-bad">Pending: {priced.pending}</p>}
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>Charge</th><th>Courier amount</th><th>Margin applied</th><th>Customer amount (pre-tax)</th></tr></thead>
            <tbody>
              {(priced?.lines ?? []).map((l, i) => <tr key={i}><td className="small">{l.label} <span className="tiny muted">({l.code})</span></td><td>{formatINR(l.costPreTax)}</td><td className="small">{l.markupEligible ? "yes" : "no"}</td><td>{formatINR(l.sellPreTax)}</td></tr>)}
              <tr><td className="b small">Subtotal</td><td className="b">{formatINR(priced?.costPreTax ?? 0)}</td><td className="small">{priced?.markup ? `${priced.markup.bps / 100}%` : ""}</td><td className="b">{formatINR(priced?.sellingSubtotal ?? 0)}</td></tr>
              <tr><td className="small">GST</td><td /><td /><td>{formatINR(priced?.gst ?? 0)}</td></tr>
              <tr><td className="b small">Customer total</td><td /><td /><td className="b">{formatINR(priced?.total ?? q.totalPaise)}</td></tr>
            </tbody></table></div>
          {priced?.providerComponents && <p className="tiny muted" style={{ marginTop: 8 }}>Raw courier components: {priced.providerComponents.map((c) => `${c.label} ${formatINR(c.amount)}`).join(" · ")}</p>}
        </section>
      )}
      <section className="card mt16" id="tracking" style={{ padding: 16, scrollMarginTop: 80 }}>
        <h2 className="b small" style={{ marginTop: 0 }}>Event history</h2>
        <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Time (IST)</th><th>Status</th><th>Raw</th><th>Location</th><th>Source</th></tr></thead>
          <tbody>{events.map((e) => <tr key={e.id}><td className="small">{e.occurredAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</td><td>{statusLabel(e.status)}</td><td className="mono tiny">{e.rawStatus}</td><td className="small">{e.location}</td><td className="small">{e.source}</td></tr>)}</tbody></table></div>
      </section>
    </>
  );
}
