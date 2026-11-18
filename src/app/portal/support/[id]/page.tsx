import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { rechargeStatus } from "@/lib/recharge";
import { AutoRefresh } from "@/components/portal/AutoRefresh";
import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { portalContext } from "@/server/portal/context";
import { newId } from "@/server/util/ids";

export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await portalContext();
  const db = await getDb();
  const [t] = await db.select().from(schema.tickets).where(and(eq(schema.tickets.id, id), eq(schema.tickets.orgId, ctx.org.id)));
  if (!t) notFound();
  const msgs = await db.select().from(schema.ticketMessages).where(eq(schema.ticketMessages.ticketId, id)).orderBy(asc(schema.ticketMessages.createdAt));
  const [rc] = t.category === "wallet_recharge" ? await db.select({ id: schema.recharges.id, n: schema.recharges.requestNumber, status: schema.recharges.status }).from(schema.recharges).where(and(eq(schema.recharges.ticketId, id), eq(schema.recharges.orgId, ctx.org.id))) : [];

  async function reply(fd: FormData) {
    "use server";
    const c = await portalContext();
    const body = String(fd.get("body") ?? "").trim();
    if (body.length < 2 || body.length > 4000) return;
    const d = await getDb();
    const [own] = await d.select({ id: schema.tickets.id }).from(schema.tickets).where(and(eq(schema.tickets.id, id), eq(schema.tickets.orgId, c.org.id)));
    if (!own) return;
    await d.insert(schema.ticketMessages).values({ id: newId("tm"), ticketId: id, authorUserId: c.session.userId, authorKind: "customer", body });
    await d.update(schema.tickets).set({ status: "open" }).where(eq(schema.tickets.id, id));
    redirect(`/portal/support/${id}/`);
  }

  const time = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <div className="chat-page">
      <AutoRefresh active={t.status !== "closed"} everyMs={20_000} />
      <header className="chat-head">
        <Link href="/portal/support/" className="chat-back" aria-label="Back to my tickets">←</Link>
        <div><h1>{t.category === "chat" ? "Support Chat" : t.subject}</h1><p className="tiny muted">{t.number}{t.awb ? ` · AWB ${t.awb}` : ""} · <span className={`chip c-${t.status}`}>{t.status.replace(/_/g, " ")}</span></p></div>
      </header>
      {rc && <Link className="note row" style={{ gap: 8 }} href={`/portal/billing/recharges/${rc.id}/`}>Recharge request <b>{rc.n}</b> · {rechargeStatus(rc.status).label} — view details{rc.status === "info_required" ? " and send the requested information" : ""} →</Link>}
      <div className="chat-thread" aria-live="polite">
        <p className="chat-msg them"><span>Hi! How can we help you today?</span></p>
        {msgs.map((m) => (
          <p key={m.id} className={`chat-msg ${m.authorKind === "staff" ? "them" : "me"}`}>
            <span>{m.body}</span>
            <small>{m.authorKind === "staff" ? "Vishwaship support" : "You"} · {time(m.createdAt)}</small>
          </p>
        ))}
      </div>
      <form action={reply} className="chat-input">
        <label htmlFor="r" className="sr-only">Message</label>
        <input id="r" name="body" placeholder="Type a message" required minLength={2} maxLength={4000} autoComplete="off" />
        <button aria-label="Send">➤</button>
      </form>
    </div>
  );
}
