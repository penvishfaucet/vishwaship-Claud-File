import { notFound, redirect } from "next/navigation";
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

  return (
    <>
      <div className="page-h"><div><h1>{t.subject}</h1><p className="small muted" style={{ margin: "4px 0 0" }}>{t.number} · {t.category.replace(/_/g, " ")}{t.awb ? ` · AWB ${t.awb}` : ""} · <span className={`chip c-${t.status}`}>{t.status}</span></p></div></div>
      <div className="col" style={{ gap: 10, maxWidth: 760 }}>
        {msgs.map((m) => (
          <div key={m.id} className="card" style={{ padding: 14, borderLeft: m.authorKind === "staff" ? "3px solid var(--orange)" : undefined }}>
            <div className="tiny muted">{m.authorKind === "staff" ? "Vishwaship support" : "You"} · {m.createdAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</div>
            <p className="small" style={{ margin: "6px 0 0", whiteSpace: "pre-wrap" }}>{m.body}</p>
          </div>
        ))}
        <form action={reply} className="card col" style={{ padding: 14, gap: 8 }}>
          <label htmlFor="r" className="sr-only">Reply</label>
          <textarea id="r" name="body" className="textarea" rows={3} placeholder="Write a reply…" required />
          <button className="btn btn-orange btn-sm" style={{ alignSelf: "start" }}>Send reply</button>
        </form>
      </div>
    </>
  );
}
