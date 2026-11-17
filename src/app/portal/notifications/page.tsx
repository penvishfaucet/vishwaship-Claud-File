import Link from "next/link";
import { and, desc, eq, isNull, or } from "drizzle-orm";
import { NotificationTab } from "@/components/portal/NotificationTab";
import { getDb, schema } from "@/server/db/client";
import { CHANNELS, NOTIFY_EVENTS } from "@/server/notifications/events";
import { portalContext } from "@/server/portal/context";

const LABEL: Record<string, string> = { email: "Email", sms: "SMS", whatsapp: "WhatsApp", webhook: "Webhook" };

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const sp = await searchParams;
  const tab = (CHANNELS as readonly string[]).includes(sp.tab ?? "") ? sp.tab! : "email";
  const ctx = await portalContext();
  const db = await getDb();
  // Org settings override admin defaults (org_id null) within admin policy.
  const rows = await db.select().from(schema.notificationSettings)
    .where(and(eq(schema.notificationSettings.channel, tab), or(eq(schema.notificationSettings.orgId, ctx.org.id), isNull(schema.notificationSettings.orgId))));
  const pick = (event: string) => rows.find((r) => r.orgId === ctx.org.id && r.event === event) ?? rows.find((r) => r.orgId === null && r.event === event);
  const master = pick("*");
  const events = NOTIFY_EVENTS.map((e) => {
    const r = pick(e.key);
    return { key: e.key, label: e.label, enabled: r?.enabled ?? false, updatedAt: r?.updatedAt?.toISOString() ?? null };
  });
  const [endpoint] = tab === "webhook" ? await db.select().from(schema.webhookEndpoints).where(eq(schema.webhookEndpoints.orgId, ctx.org.id)) : [];
  const log = await db.select().from(schema.notificationDeliveries).where(and(eq(schema.notificationDeliveries.orgId, ctx.org.id), eq(schema.notificationDeliveries.channel, tab))).orderBy(desc(schema.notificationDeliveries.createdAt)).limit(20);
  return (
    <>
      <div className="page-h">
        <h1>Shipping Notifications</h1>
        <div className="actions">
          <span className="pill2">Credit balance: <b>{ctx.credits.toLocaleString("en-IN")}</b></span>
          <Link className="btn btn-orange" href="/portal/billing/?tab=credits">Buy Credits</Link>
        </div>
      </div>
      <nav className="tabs" aria-label="Channels">
        {CHANNELS.map((c) => <Link key={c} href={`/portal/notifications/?tab=${c}`} className={tab === c ? "on" : ""}>{LABEL[c]}</Link>)}
        <Link href="/portal/notifications/cod/">COD Confirmation</Link>
      </nav>
      <NotificationTab channel={tab} master={master?.enabled ?? false} events={events} webhookUrl={endpoint?.url ?? ""} />
      <section className="card p0 mt16">
        <h2 className="b small card-h" style={{ margin: 0 }}>Delivery log</h2>
        {log.length === 0 ? <p className="small muted" style={{ padding: 16 }}>No {LABEL[tab]} notifications sent yet.</p> : (
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Time</th><th>Event</th><th>Recipient</th><th>Status</th><th>Credits</th></tr></thead>
            <tbody>{log.map((l) => <tr key={l.id}><td className="small">{l.createdAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</td><td className="small">{l.event}</td><td className="small mono">{l.recipientMasked}</td><td><span className="chip c-pending">{l.status}</span></td><td>{l.creditsCharged}</td></tr>)}</tbody></table></div>
        )}
      </section>
    </>
  );
}
