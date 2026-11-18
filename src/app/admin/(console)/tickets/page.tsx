import { redirect } from "next/navigation";
import { asc, desc, eq } from "drizzle-orm";
import { audit } from "@/server/audit";
import { can } from "@/server/auth/rbac";
import { requireStaff } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { newId } from "@/server/util/ids";

async function reply(fd: FormData) {
  "use server";
  const s = await requireStaff("tickets.write");
  const id = String(fd.get("id")), body = String(fd.get("body") ?? "").trim(), status = String(fd.get("status") ?? "awaiting_customer");
  const db = await getDb();
  const [t] = await db.select().from(schema.tickets).where(eq(schema.tickets.id, id));
  if (!t) return;
  if (body) await db.insert(schema.ticketMessages).values({ id: newId("tm"), ticketId: id, authorUserId: s.userId, authorKind: "staff", body });
  await db.update(schema.tickets).set({ status: ["open", "awaiting_customer", "resolved", "closed"].includes(status) ? status : "open" }).where(eq(schema.tickets.id, id));
  await db.insert(schema.inAppAlerts).values({ id: newId("al"), orgId: t.orgId, kind: "ticket", title: `Ticket ${t.number} updated`, href: `/portal/support/${id}/` });
  await audit({ actorUserId: s.userId, actorKind: "staff", orgId: t.orgId, action: "ticket.reply", targetType: "ticket", targetId: id, details: { status } });
  redirect(`/admin/tickets/?open=${id}`);
}

export default async function AdminTickets({ searchParams }: { searchParams: Promise<{ open?: string }> }) {
  const sp = await searchParams;
  const s = await requireStaff("tickets.read");
  const db = await getDb();
  const rows = await db.select({ t: schema.tickets, o: schema.orgs }).from(schema.tickets).innerJoin(schema.orgs, eq(schema.orgs.id, schema.tickets.orgId)).orderBy(desc(schema.tickets.createdAt));
  const open = sp.open ? rows.find((r) => r.t.id === sp.open) : undefined;
  const msgs = open ? await db.select().from(schema.ticketMessages).where(eq(schema.ticketMessages.ticketId, open.t.id)).orderBy(asc(schema.ticketMessages.createdAt)) : [];
  const [linkedRc] = open && open.t.category === "wallet_recharge" ? await db.select({ id: schema.recharges.id, n: schema.recharges.requestNumber }).from(schema.recharges).where(eq(schema.recharges.ticketId, open.t.id)) : [];
  return (
    <>
      <div className="page-h"><h1>Tickets</h1></div>
      <div className="split" style={{ gap: 16, alignItems: "start" }}>
        <div className="card p0"><ul className="plain-list">{rows.length === 0 && <li className="small muted">No tickets.</li>}{rows.map(({ t, o }) => <li key={t.id}><a className="row between" href={`/admin/tickets/?open=${t.id}`}><span><b className="small">{t.number}</b> <span className="small">{t.subject}</span><span className="tiny muted" style={{ display: "block" }}>{o.businessName} · {t.category}{t.awb ? ` · ${t.awb}` : ""}</span></span><span className={`chip c-${t.status}`}>{t.status}</span></a></li>)}</ul></div>
        {open && (
          <div className="col" style={{ gap: 8 }}>
            {linkedRc && <a className="note" href={`/admin/recharges/?id=${linkedRc.id}`}>Manual recharge <b>{linkedRc.n}</b> — open to review the screenshot and approve / reject →</a>}
            {msgs.map((m) => <div key={m.id} className="card" style={{ padding: 12, borderLeft: m.authorKind === "staff" ? "3px solid var(--orange)" : undefined }}><div className="tiny muted">{m.authorKind} · {m.createdAt.toLocaleString("en-IN")}</div><p className="small" style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>{m.body}</p></div>)}
            {can(s.role, "tickets.write") && (
              <form action={reply} className="card col" style={{ padding: 12, gap: 8 }}>
                <input type="hidden" name="id" value={open.t.id} />
                <label htmlFor="tb" className="sr-only">Reply</label><textarea id="tb" name="body" className="textarea" rows={3} placeholder="Reply to customer" />
                <div className="row" style={{ gap: 8 }}><select aria-label="Status" name="status" className="select" defaultValue="awaiting_customer"><option value="awaiting_customer">Awaiting customer</option><option value="open">Open</option><option value="resolved">Resolved</option><option value="closed">Closed</option></select><button className="btn btn-orange btn-sm">Send</button></div>
              </form>
            )}
          </div>
        )}
      </div>
    </>
  );
}
