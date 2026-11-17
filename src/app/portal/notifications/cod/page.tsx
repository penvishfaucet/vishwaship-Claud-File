import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { CodActions } from "@/components/portal/CodActions";
import { CodToggle } from "@/components/portal/CodToggle";
import { formatINR } from "@/lib/money";
import { getDb, schema } from "@/server/db/client";
import { eventIncluded, resolveFeatures } from "@/server/features";
import { portalContext } from "@/server/portal/context";
import { codSettings, whatsappMode } from "@/server/whatsapp/service";

const FILTERS = ["pending", "confirmed", "rejected", "no_response", "needs_review", "send_failed"] as const;
const LABEL: Record<string, string> = { pending: "Pending", confirmed: "Confirmed", rejected: "Rejected", no_response: "No Response", needs_review: "Needs review", send_failed: "Send failed", expired: "Expired" };
const CHIP: Record<string, string> = { confirmed: "c-active", rejected: "c-failed", send_failed: "c-failed", pending: "c-pending", no_response: "c-draft", needs_review: "c-pending" };
const CANCEL: Record<string, string> = { requested: "Cancellation requested", cancelled: "Cancelled", failed: "Cancellation Failed", action_required: "Action Required" };
const NO_REPLY: Record<string, string> = { release: "the order stays active and is released for shipping", hold_for_review: "the order is held for your review", cancel: "the order is cancelled" };
const fmt = (d: Date | null) => d?.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }) ?? "—";

export default async function CodPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const sp = await searchParams;
  const ctx = await portalContext();
  const db = await getDb();
  const [setting] = await db.select().from(schema.notificationSettings).where(and(eq(schema.notificationSettings.orgId, ctx.org.id), eq(schema.notificationSettings.channel, "whatsapp"), eq(schema.notificationSettings.event, "cod_confirmation")));
  const cfg = await codSettings();
  const included = await eventIncluded(ctx.org.id, "whatsapp:cod_confirmation");
  const { plan } = await resolveFeatures(ctx.org.id);
  const mode = await whatsappMode();
  const rows = await db.select({ c: schema.codConfirmations, o: schema.orders }).from(schema.codConfirmations).innerJoin(schema.orders, eq(schema.orders.id, schema.codConfirmations.orderId))
    .where(eq(schema.codConfirmations.orgId, ctx.org.id)).orderBy(desc(schema.codConfirmations.createdAt)).limit(200);
  const list = rows.filter((r) => (!sp.status || r.c.status === sp.status) && (!sp.q || r.o.orderNumber.toLowerCase().includes(sp.q.toLowerCase())));
  const enabled = !!setting?.enabled && included;
  return (
    <>
      <div className="page-h">
        <div><Link className="small link-navy" href="/portal/notifications/?tab=whatsapp">← Shipping Notifications</Link><h1>COD Confirmation</h1></div>
        <div className="actions">
          <span className={`chip ${enabled ? "c-active" : "c-draft"}`}>{enabled ? "Subscribed" : "Not subscribed"}</span>
          <span className="pill2">Credits: <b>{ctx.credits}</b></span>
        </div>
      </div>
      {mode === "demo" && <p className="note small mb12"><b>Demo mode</b> — no WhatsApp provider is connected, so messages are recorded but not delivered, no credits are used, and you can simulate the buyer’s reply. This never happens in production.</p>}
      <section className="card mb16" style={{ padding: 18 }}>
        <div className="row between wrap" style={{ gap: 16 }}>
          <div style={{ maxWidth: 560 }}>
            <b>WhatsApp COD confirmation</b>
            <p className="small muted" style={{ margin: "6px 0" }}>Before a COD order is booked, the buyer gets a WhatsApp message with <b>Confirm Order</b> and <b>Cancel Order</b> buttons. Confirm releases the order for shipping. Cancel cancels it (and asks the courier to cancel if it was already booked). If there is no reply within {Math.round(cfg.expiryMinutes / 60)} h, the status becomes <b>No Response</b> and {NO_REPLY[cfg.noReply]}.</p>
            <p className="small" style={{ margin: 0 }}><b>{cfg.credits} credits</b> per confirmation. Prepaid orders are not affected.</p>
          </div>
          {included ? <CodToggle enabled={!!setting?.enabled} /> : <Link className="btn btn-orange" href="/portal/upgrade/?module=whatsapp_notifications">Upgrade plan</Link>}
        </div>
        {!included && <p className="small mt8 t-debit">Not included in your {plan ? `“${plan.name}” plan` : "account"}.{setting?.enabled ? " Your earlier setting is paused." : ""}</p>}
        <div className="note mt12 small" style={{ whiteSpace: "pre-line" }}>
          <b>Message preview</b>{"\n"}Hi Ravi, please confirm your Cash on Delivery order VSA1001 from {ctx.org.businessName} for ₹1,499.{"\n"}[ Confirm Order ]  [ Cancel Order ]
        </div>
      </section>
      <div className="pills mb12">
        <Link className={!sp.status ? "pill on" : "pill"} href="/portal/notifications/cod/">All {rows.length}</Link>
        {FILTERS.map((f) => <Link key={f} className={sp.status === f ? "pill on" : "pill"} href={`/portal/notifications/cod/?status=${f}`}>{LABEL[f]} {rows.filter((r) => r.c.status === f).length}</Link>)}
      </div>
      {list.length === 0 ? <div className="card empty"><p className="muted">No COD confirmations {sp.status ? `with status “${LABEL[sp.status] ?? sp.status}”` : "yet"}.</p></div> : (
        <div className="card p0 tbl-wrap"><table className="tbl"><thead><tr><th>Order</th><th>COD</th><th>Sent</th><th>Status</th><th>Buyer response</th><th>Cancellation</th><th>Actions</th></tr></thead>
          <tbody>{list.map(({ c, o }) => (
            <tr key={c.id}>
              <td><Link className="link-navy" href={`/portal/orders/${o.id}/`}>{o.orderNumber}</Link></td>
              <td>{formatINR(o.codAmountPaise)}</td>
              <td className="small">{c.sentAt ? fmt(c.sentAt) : c.status === "pending" ? "Queued" : "—"}</td>
              <td><span className={`chip ${CHIP[c.status] ?? "c-pending"}`}>{LABEL[c.status] ?? c.status}</span></td>
              <td className="small">{c.buyerResponse ? `${c.buyerResponse === "confirm" ? "Confirm Order" : "Cancel Order"} · ${fmt(c.decidedAt)}` : c.decidedAt ? `Decided by you · ${fmt(c.decidedAt)}` : "—"}</td>
              <td className="small">{c.cancellationStatus ? <><b>{CANCEL[c.cancellationStatus]}</b>{c.cancellationReason && <div className="tiny muted">{c.cancellationReason}</div>}</> : "—"}</td>
              <td><CodActions id={c.id} status={c.status} demo={mode === "demo"} /></td>
            </tr>
          ))}</tbody></table></div>
      )}
    </>
  );
}
