import { and, asc, desc, eq, ilike, inArray, notInArray, or, type SQL } from "drizzle-orm";
import { can } from "@/server/auth/rbac";
import { requireStaff } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { STATUS_LABEL, TICKET_TABS, type TicketAttachment, type TicketTab, categoryLabel, customerStatus, isTicketTab } from "@/lib/support";
import { Attachments } from "@/components/portal/support/Attachments";
import { TicketComposer } from "@/components/portal/support/TicketComposer";
import { AutoRefresh } from "@/components/portal/AutoRefresh";

const when = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

/** Support desk: find a ticket (ID, Order ID, AWB, customer), read the thread, reply with text / file, set Open · Resolved · Closed. */
export default async function AdminTickets({ searchParams }: { searchParams: Promise<{ open?: string; tab?: string; q?: string }> }) {
  const sp = await searchParams;
  const s = await requireStaff("tickets.read");
  const tab: TicketTab = isTicketTab(sp.tab) ? sp.tab : "open";
  const q = (sp.q ?? "").trim().slice(0, 60);
  const db = await getDb();
  const T = schema.tickets;
  const conds: SQL[] = [];
  if (tab === "open") conds.push(notInArray(T.status, ["resolved", "closed"]));
  if (tab === "resolved") conds.push(inArray(T.status, ["resolved"]));
  if (tab === "closed") conds.push(inArray(T.status, ["closed"]));
  if (q) { const like = `%${q.replace(/^#/, "").replace(/[%_\\]/g, "")}%`; conds.push(or(ilike(T.number, like), ilike(T.orderNumber, like), ilike(T.awb, like), ilike(schema.orgs.businessName, like))!); }
  const rows = await db.select({ t: T, o: schema.orgs }).from(T).innerJoin(schema.orgs, eq(schema.orgs.id, T.orgId)).where(conds.length ? and(...conds) : undefined).orderBy(desc(T.updatedAt)).limit(200);
  const [openRow] = sp.open ? await db.select({ t: T, o: schema.orgs }).from(T).innerJoin(schema.orgs, eq(schema.orgs.id, T.orgId)).where(eq(T.id, sp.open)) : [];
  const msgs = openRow ? await db.select().from(schema.ticketMessages).where(eq(schema.ticketMessages.ticketId, openRow.t.id)).orderBy(asc(schema.ticketMessages.createdAt)) : [];
  const [linkedRc] = openRow && openRow.t.category === "wallet_recharge" ? await db.select({ id: schema.recharges.id, n: schema.recharges.requestNumber }).from(schema.recharges).where(eq(schema.recharges.ticketId, openRow.t.id)) : [];
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams({ ...(tab !== "open" ? { tab } : {}), ...(q ? { q } : {}), ...(sp.open ? { open: sp.open } : {}) });
    for (const [k, v] of Object.entries(patch)) { if (v) p.set(k, v); else p.delete(k); }
    const x = p.toString();
    return `/admin/tickets/${x ? `?${x}` : ""}`;
  };

  return (
    <>
      <div className="page-h"><h1>Tickets</h1></div>
      <div className="row wrap" style={{ gap: 8, marginBottom: 12 }}>
        <nav className="seg-tabs" aria-label="Ticket status">
          {TICKET_TABS.map((t) => <a key={t} href={qs({ tab: t === "open" ? undefined : t, open: undefined })} className={tab === t ? "on" : ""} aria-current={tab === t ? "page" : undefined}>{t === "all" ? "All" : STATUS_LABEL[t]}</a>)}
        </nav>
        <form className="row" style={{ gap: 6 }} action="/admin/tickets/" role="search">
          {tab !== "open" && <input type="hidden" name="tab" value={tab} />}
          <label className="sr-only" htmlFor="atq">Search tickets</label>
          <input id="atq" name="q" defaultValue={q} className="input" placeholder="Ticket ID, Order ID, AWB or customer" style={{ minWidth: 260 }} />
          <button className="btn btn-sm btn-navy">Search</button>
        </form>
      </div>
      <div className="split" style={{ gap: 16, alignItems: "start" }}>
        <div className="card p0">
          <ul className="plain-list">
            {rows.length === 0 && <li className="small muted" style={{ padding: 12 }}>No tickets{q ? ` match “${q}”` : ""}.</li>}
            {rows.map(({ t, o }) => {
              const st = customerStatus(t.status);
              return (
                <li key={t.id} style={openRow?.t.id === t.id ? { background: "var(--orange-soft)" } : undefined}>
                  <a className="row between" href={qs({ open: t.id })} style={{ gap: 8 }}>
                    <span style={{ minWidth: 0 }}><b className="small">#{t.number}</b> <span className="small">{categoryLabel(t.category)}</span>
                      <span className="tiny muted" style={{ display: "block" }}>{o.businessName}{t.orderNumber ? ` · ${t.orderNumber}` : ""}{t.awb ? ` · AWB ${t.awb}` : ""} · {when(t.updatedAt)}</span></span>
                    <span className={`tk-st ${st}`}>{STATUS_LABEL[st]}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
        {openRow ? (
          <section className="card col tk-admin" style={{ padding: 14, gap: 10 }} aria-label={`Ticket ${openRow.t.number}`}>
            <AutoRefresh active everyMs={30_000} />
            <div className="row between" style={{ gap: 8 }}>
              <div><h2 style={{ fontSize: 17, margin: 0 }}>Ticket #{openRow.t.number}</h2><p className="tiny muted" style={{ margin: 0 }}>{openRow.o.businessName} · Last update {when(openRow.t.updatedAt)}</p></div>
              <span className={`tk-st ${customerStatus(openRow.t.status)}`}>{STATUS_LABEL[customerStatus(openRow.t.status)]}</span>
            </div>
            <div className="tk-meta" style={{ padding: 0 }}>
              <span><b>Category:</b> {categoryLabel(openRow.t.category)}</span>
              {openRow.t.orderNumber && <span><b>Order ID:</b> {openRow.t.orderNumber}</span>}
              {openRow.t.awb && <span><b>AWB:</b> {openRow.t.awb}</span>}
            </div>
            {linkedRc && <a className="note" href={`/admin/recharges/?id=${linkedRc.id}`}>Manual recharge <b>{linkedRc.n}</b> — open to review the screenshot and approve / reject →</a>}
            <ol className="chat-thread" style={{ padding: 0 }}>
              {msgs.map((m) => {
                const staff = m.authorKind === "staff";
                return (
                  <li key={m.id} className={`chat-msg ${staff ? "me" : "them"}`}>
                    <small className="who">{staff ? "Vishwaship Support" : openRow.o.businessName}, {when(m.createdAt)}</small>
                    <span>{m.body}{(m.attachments as TicketAttachment[]).length > 0 && <Attachments base={`/api/admin/tickets/${openRow.t.id}/files`} msgId={m.id} files={m.attachments as TicketAttachment[]} />}</span>
                  </li>
                );
              })}
            </ol>
            {can(s.role, "tickets.write")
              ? <TicketComposer ticketId={openRow.t.id} endpoint={`/api/admin/tickets/${openRow.t.id}/reply`} withStatus currentStatus={openRow.t.status} />
              : <p className="small muted">You can read tickets but not reply.</p>}
          </section>
        ) : <div className="card empty"><p className="muted small">Select a ticket to read the conversation and reply.</p></div>}
      </div>
    </>
  );
}
