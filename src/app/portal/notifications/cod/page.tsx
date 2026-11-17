import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { CodToggle } from "@/components/portal/CodToggle";
import { formatINR } from "@/lib/money";
import { getDb, schema } from "@/server/db/client";
import { portalContext } from "@/server/portal/context";
import { getSetting } from "@/server/quotes/service";

const FILTERS = ["pending", "confirmed", "declined", "expired", "needs_review", "send_failed"] as const;

export default async function CodPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string }> }) {
  const sp = await searchParams;
  const ctx = await portalContext();
  const db = await getDb();
  const [setting] = await db.select().from(schema.notificationSettings).where(and(eq(schema.notificationSettings.orgId, ctx.org.id), eq(schema.notificationSettings.channel, "whatsapp"), eq(schema.notificationSettings.event, "cod_confirmation")));
  const cfg = await getSetting("cod_confirmation", { reminderMinutes: 120, expiryMinutes: 1440, noReply: "hold_for_review", credits: 2 });
  const rows = await db.select({ c: schema.codConfirmations, o: schema.orders }).from(schema.codConfirmations).innerJoin(schema.orders, eq(schema.orders.id, schema.codConfirmations.orderId))
    .where(eq(schema.codConfirmations.orgId, ctx.org.id)).orderBy(desc(schema.codConfirmations.createdAt)).limit(100);
  const list = rows.filter((r) => (!sp.status || r.c.status === sp.status) && (!sp.q || r.o.orderNumber.toLowerCase().includes(sp.q.toLowerCase())));
  const enabled = !!setting?.enabled;
  return (
    <>
      <div className="page-h">
        <div><Link className="small link-navy" href="/portal/notifications/?tab=whatsapp">← Shipping Notifications</Link><h1>COD Confirmation</h1></div>
        <div className="actions"><span className={`chip ${enabled ? "c-active" : "c-draft"}`}>{enabled ? "Subscribed" : "Not subscribed"}</span><span className="pill2">Credits: <b>{ctx.credits}</b></span></div>
      </div>
      <section className="card mb16" style={{ padding: 18 }}>
        <div className="row between wrap" style={{ gap: 16 }}>
          <div style={{ maxWidth: 520 }}>
            <b>WhatsApp COD confirmation</b>
            <p className="small muted" style={{ margin: "6px 0" }}>Before a COD order is booked, we send the buyer a WhatsApp message to Confirm or Cancel. Orders wait (not booked, no pickup) until they reply. Reminder after {cfg.value.reminderMinutes / 60} h; expires after {cfg.value.expiryMinutes / 60} h → {cfg.value.noReply === "hold_for_review" ? "held for your review" : cfg.value.noReply}.</p>
            <p className="small" style={{ margin: 0 }}><b>{cfg.value.credits} credits</b> per confirmation (≈ {formatINR(cfg.value.credits * 25)}). Prepaid orders are not affected.</p>
          </div>
          <CodToggle enabled={enabled} />
        </div>
        <div className="note mt12 small" style={{ whiteSpace: "pre-line" }}>
          <b>Template preview</b>{"\n"}Hi Ravi, please confirm your Cash on Delivery order VSA1001 from {ctx.org.businessName} for ₹1,499.{"\n"}[ Confirm ]  [ Cancel ]
        </div>
        <p className="tiny muted mt8">Reminder, expiry and no-reply behaviour are set by Vishwaship admin.</p>
      </section>
      <div className="pills mb12">
        <Link className={!sp.status ? "pill on" : "pill"} href="/portal/notifications/cod/">All {rows.length}</Link>
        {FILTERS.map((f) => <Link key={f} className={sp.status === f ? "pill on" : "pill"} href={`/portal/notifications/cod/?status=${f}`}>{f.replace("_", " ")} {rows.filter((r) => r.c.status === f).length}</Link>)}
      </div>
      {list.length === 0 ? <div className="card empty"><p className="muted">No COD confirmations {sp.status ? `with status “${sp.status.replace("_", " ")}”` : "yet"}.</p></div> : (
        <div className="card p0 tbl-wrap"><table className="tbl"><thead><tr><th>Order</th><th>COD</th><th>Sent</th><th>Status</th><th>Decided</th></tr></thead>
          <tbody>{list.map(({ c, o }) => <tr key={c.id}><td><Link className="link-navy" href={`/portal/orders/${o.id}/`}>{o.orderNumber}</Link></td><td>{formatINR(o.codAmountPaise)}</td><td className="small">{c.sentAt?.toLocaleString("en-IN") ?? "Queued"}</td><td><span className="chip c-pending">{c.status.replace("_", " ")}</span></td><td className="small">{c.decidedAt?.toLocaleString("en-IN") ?? "—"}</td></tr>)}</tbody></table></div>
      )}
    </>
  );
}
