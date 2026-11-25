import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { CodActions } from "@/components/portal/CodActions";
import { CodSetup } from "@/components/portal/CodSetup";
import { ORG_SETTING_SCHEMAS } from "@/lib/org-settings";
import { orgSetting } from "@/server/couriers";
import { creditPrice } from "@/server/notifications/credits";
import { formatINR } from "@/lib/money";
import { getDb, schema } from "@/server/db/client";
import { eventIncluded } from "@/server/features";
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
  const included = (await (await import("@/server/free-trial")).orgInFreeTrial(ctx.org.id)) || (await eventIncluded(ctx.org.id, "whatsapp:cod_confirmation"));
  const codOn = await (await import("@/server/whatsapp/service")).codConfirmationOn(ctx.org.id);
  const mode = await whatsappMode();
  const msg = ORG_SETTING_SCHEMAS.cod_message.parse((await orgSetting(ctx.org.id, "cod_message")) ?? {});
  const price = await creditPrice();
  const [wh] = await db.select({ mobile: schema.warehouses.mobile }).from(schema.warehouses).where(and(eq(schema.warehouses.orgId, ctx.org.id), eq(schema.warehouses.isDefault, true))).limit(1);
  const rows = await db.select({ c: schema.codConfirmations, o: schema.orders }).from(schema.codConfirmations).innerJoin(schema.orders, eq(schema.orders.id, schema.codConfirmations.orderId))
    .where(eq(schema.codConfirmations.orgId, ctx.org.id)).orderBy(desc(schema.codConfirmations.createdAt)).limit(200);
  const list = rows.filter((r) => (!sp.status || r.c.status === sp.status) && (!sp.q || r.o.orderNumber.toLowerCase().includes(sp.q.toLowerCase())));
  return (
    <>
      <Link className="small link-navy" href="/portal/notifications/?tab=whatsapp">← Shipping Notifications</Link>
      <CodSetup enabled={(setting ? setting.enabled : codOn) && included} included={included} msg={msg} businessName={ctx.org.businessName} defaultPhone={wh?.mobile ?? ""}
        credits={ctx.credits} perMessage={cfg.credits} paisePerCredit={price.paisePerCredit} expiryHours={Math.round(cfg.expiryMinutes / 60)} noReplyText={NO_REPLY[cfg.noReply]}
        demo={mode === "demo"} live={mode === "live"} />
      <h2 className="b mt16" style={{ fontSize: 17 }}>Confirmations</h2>
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
