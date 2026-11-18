import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { ChevronLeft } from "lucide-react";
import { rechargeStatus } from "@/lib/recharge";
import { AutoRefresh } from "@/components/portal/AutoRefresh";
import { TicketComposer } from "@/components/portal/support/TicketComposer";
import { Attachments } from "@/components/portal/support/Attachments";
import { getDb, schema } from "@/server/db/client";
import { portalContext } from "@/server/portal/context";
import { STATUS_LABEL, type TicketAttachment, categoryLabel, customerStatus } from "@/lib/support";
import { safeTicketsBack } from "@/lib/support-nav";

const full = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true }).replace(/am|pm/, (m) => m.toUpperCase());
function ago(d: Date) {
  const m = Math.round((Date.now() - d.getTime()) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h > 1 ? "s" : ""} ago`;
  const dd = Math.round(h / 24);
  return dd < 30 ? `${dd} day${dd > 1 ? "s" : ""} ago` : full(d);
}

export default async function TicketPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ back?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await portalContext();
  const db = await getDb();
  const [t] = await db.select().from(schema.tickets).where(and(eq(schema.tickets.id, id), eq(schema.tickets.orgId, ctx.org.id)));
  if (!t) notFound();
  const msgs = await db.select().from(schema.ticketMessages).where(eq(schema.ticketMessages.ticketId, id)).orderBy(asc(schema.ticketMessages.createdAt));
  const [rc] = t.category === "wallet_recharge" ? await db.select({ id: schema.recharges.id, n: schema.recharges.requestNumber, status: schema.recharges.status }).from(schema.recharges).where(and(eq(schema.recharges.ticketId, id), eq(schema.recharges.orgId, ctx.org.id))) : [];
  const st = customerStatus(t.status);
  const backHref = safeTicketsBack(sp.back);

  return (
    <div className="chat-page tk-thread">
      <AutoRefresh active={st !== "closed"} everyMs={20_000} />
      <header className="chat-head">
        <Link href={backHref} className="chat-back" aria-label="Back to tickets"><ChevronLeft size={24} aria-hidden /></Link>
        <div className="grow">
          <h1>Ticket #{t.number}</h1>
          <p className="tiny muted">Last update: {full(t.updatedAt)}</p>
        </div>
        <span className={`tk-st ${st}`}>{STATUS_LABEL[st]}</span>
      </header>
      <div className="tk-meta">
        {t.orderNumber && <span><b>Order ID:</b> {t.orderNumber}</span>}
        {t.awb && <span><b>AWB:</b> {t.awb}</span>}
        <span><b>Category:</b> {categoryLabel(t.category)}</span>
      </div>
      {rc && <Link className="note row" style={{ gap: 8 }} href={`/portal/billing/recharges/${rc.id}/`}>Recharge request <b>{rc.n}</b> · {rechargeStatus(rc.status).label} — view details{rc.status === "info_required" ? " and send the requested information" : ""} →</Link>}
      <ol className="chat-thread" aria-live="polite" aria-label="Conversation">
        {msgs.length === 0 && <li className="chat-msg them"><span>Hi! How can we help you today?</span></li>}
        {msgs.map((m) => {
          const me = m.authorKind !== "staff";
          return (
            <li key={m.id} className={`chat-msg ${me ? "me" : "them"}`}>
              <small className="who">{me ? "Me" : "Vishwaship Support"}, <time dateTime={m.createdAt.toISOString()} title={full(m.createdAt)}>{ago(m.createdAt)}</time></small>
              <span>{m.body}{(m.attachments as TicketAttachment[]).length > 0 && <Attachments base={`/api/portal/support/tickets/${id}/files`} msgId={m.id} files={m.attachments as TicketAttachment[]} />}</span>
            </li>
          );
        })}
      </ol>
      {st === "closed"
        ? <p className="tk-closed small">This ticket is closed. <Link className="link" href={`/portal/support/new/${sp.back ? `?back=${encodeURIComponent(sp.back)}` : ""}`}>Raise a new ticket</Link> if you still need help.</p>
        : <TicketComposer ticketId={id} />}
    </div>
  );
}
