import Link from "next/link";
import { redirect } from "next/navigation";
import { and, desc, eq, gt, inArray, isNotNull, or } from "drizzle-orm";
import { audit } from "@/server/audit";
import { can } from "@/server/auth/rbac";
import { requireStaff } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { getSetting } from "@/server/quotes/service";
import { refreshFromCarrier } from "@/server/tracking/service";
import { type PrintFormat, PRINT_FORMATS } from "@/lib/order-view";
import { statusLabel } from "@/lib/status";

const fmt = (d: Date | null) => d?.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) ?? "—";

async function saveLabelDefault(fd: FormData) {
  "use server";
  const s = await requireStaff("shipments.write");
  const value = String(fd.get("format"));
  if (!PRINT_FORMATS.some((p) => p.key === value)) redirect("/admin/order-exceptions/?err=format");
  const db = await getDb();
  await db.insert(schema.pricingSettings).values({ key: "orders_label_default", value }).onConflictDoUpdate({ target: schema.pricingSettings.key, set: { value, updatedAt: new Date() } });
  await audit({ actorUserId: s.userId, actorKind: "staff", action: "orders.label_default", details: { format: value } });
  redirect("/admin/order-exceptions/?ok=label");
}

async function retrySync(fd: FormData) {
  "use server";
  const s = await requireStaff("shipments.write");
  const id = String(fd.get("id")).slice(0, 64);
  const r = await refreshFromCarrier(id);
  await audit({ actorUserId: s.userId, actorKind: "staff", action: "tracking.retry_sync", targetType: "shipment", targetId: id, details: { ok: r.ok, message: r.ok ? undefined : r.message } });
  redirect(`/admin/order-exceptions/?${r.ok ? "ok=sync" : `err=${encodeURIComponent(r.message.slice(0, 120))}`}`);
}

/** Admin visibility: tracking sync failures and WhatsApp-COD cancellation exceptions, plus Orders label default. */
export default async function OrderExceptions({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const staff = await requireStaff("shipments.read");
  const canWrite = can(staff.role, "shipments.write");
  const db = await getDb();
  const syncRows = await db.select({ s: schema.shipments, o: schema.orgs, n: schema.orders.orderNumber }).from(schema.shipments)
    .innerJoin(schema.orgs, eq(schema.orgs.id, schema.shipments.orgId)).innerJoin(schema.orders, eq(schema.orders.id, schema.shipments.orderId))
    .where(and(or(gt(schema.shipments.syncFailures, 0), isNotNull(schema.shipments.lastSyncError)), inArray(schema.shipments.bookingStatus, ["confirmed", "pending"])))
    .orderBy(desc(schema.shipments.syncFailures)).limit(200);
  const cancelRows = await db.select({ c: schema.codConfirmations, o: schema.orgs, n: schema.orders.orderNumber }).from(schema.codConfirmations)
    .innerJoin(schema.orgs, eq(schema.orgs.id, schema.codConfirmations.orgId)).innerJoin(schema.orders, eq(schema.orders.id, schema.codConfirmations.orderId))
    .where(inArray(schema.codConfirmations.cancellationStatus, ["failed", "action_required", "requested"])).orderBy(desc(schema.codConfirmations.cancellationAt)).limit(200);
  const labelDefault = (await getSetting<PrintFormat>("orders_label_default", "thermal_4x4")).value;
  return (
    <>
      <div className="page-h"><div><h1>Order Exceptions</h1><p className="small muted" style={{ margin: "4px 0 0" }}>Tracking sync failures and WhatsApp COD cancellation problems across all customers.</p></div></div>
      {sp.ok && <p className="note small mb12" role="status">{sp.ok === "sync" ? "Tracking synced." : "Saved."}</p>}
      {sp.err && <p className="note small mb12 t-debit" role="alert">{sp.err === "format" ? "Unknown label size." : `Sync failed: ${sp.err}`}</p>}

      <section className="card mb16" style={{ padding: 16 }}>
        <h2 className="b" style={{ fontSize: 16 }}>Customer Orders — label default</h2>
        <p className="small muted">Used for Download Label when the customer has not chosen one of these sizes in Settings → Label. Customers can always pick another size per download.</p>
        <form action={saveLabelDefault} className="row wrap" style={{ gap: 8 }}>
          <label className="sr-only" htmlFor="lf">Default label size</label>
          <select id="lf" name="format" className="select" defaultValue={labelDefault} style={{ maxWidth: 260 }} disabled={!canWrite}>{PRINT_FORMATS.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}</select>
          {canWrite && <button className="btn btn-navy btn-sm">Save</button>}
        </form>
        <p className="tiny muted mt8">Tab names and the COD line text are edited in <Link className="link-navy" href="/admin/content/?group=pages">Portal Text</Link> (keys “Orders – …”). WhatsApp COD rules are in <Link className="link-navy" href="/admin/notifications/">Notifications</Link>; feature access per plan in <Link className="link-navy" href="/admin/plans/">Plans &amp; Features</Link>.</p>
      </section>

      <section className="mb16">
        <h2 className="b mb12" style={{ fontSize: 16 }}>Tracking sync failures ({syncRows.length})</h2>
        {syncRows.length === 0 ? <div className="card empty"><p className="muted">No tracking sync failures.</p></div> : (
          <div className="card p0 tbl-wrap"><table className="tbl">
            <thead><tr><th>Customer</th><th>Order</th><th>Courier / AWB</th><th>Status</th><th>Last success</th><th>Failures</th><th>Last error</th><th><span className="sr-only">Action</span></th></tr></thead>
            <tbody>{syncRows.map(({ s, o, n }) => (
              <tr key={s.id}>
                <td className="small">{o.businessName}</td><td className="small">{n}</td>
                <td className="small">{s.carrierName}<div className="mono tiny"><Link className="link-navy" href={`/admin/shipments/${s.id}/`}>{s.awb ?? "AWB pending"}</Link></div></td>
                <td className="small">{statusLabel(s.status)}</td><td className="small">{fmt(s.lastSyncAt)}</td><td className="small b">{s.syncFailures}</td>
                <td className="small t-debit" style={{ maxWidth: 280 }}>{s.lastSyncError ?? "—"}</td>
                <td>{canWrite && s.awb && <form action={retrySync}><input type="hidden" name="id" value={s.id} /><button className="btn btn-sm btn-outline">Retry sync</button></form>}</td>
              </tr>))}</tbody></table></div>
        )}
      </section>

      <section>
        <h2 className="b mb12" style={{ fontSize: 16 }}>COD cancellation exceptions ({cancelRows.length})</h2>
        {cancelRows.length === 0 ? <div className="card empty"><p className="muted">No cancellation exceptions.</p></div> : (
          <div className="card p0 tbl-wrap"><table className="tbl">
            <thead><tr><th>Customer</th><th>Order</th><th>Buyer reply</th><th>Cancellation</th><th>Detail</th><th>Updated</th></tr></thead>
            <tbody>{cancelRows.map(({ c, o, n }) => (
              <tr key={c.id}>
                <td className="small">{o.businessName}</td><td className="small">{n}</td>
                <td className="small">{c.buyerResponse === "cancel" ? "Cancel Order" : c.buyerResponse === "confirm" ? "Confirm Order" : c.status.replace(/_/g, " ")}</td>
                <td><span className={`chip ${c.cancellationStatus === "requested" ? "c-pending" : "c-failed"}`}>{c.cancellationStatus === "requested" ? "Cancellation Pending" : c.cancellationStatus === "failed" ? "Cancellation Failed" : "Action Required"}</span></td>
                <td className="small" style={{ maxWidth: 340 }}>{c.cancellationReason ?? "—"}</td><td className="small">{fmt(c.cancellationAt)}</td>
              </tr>))}</tbody></table></div>
        )}
      </section>
    </>
  );
}
