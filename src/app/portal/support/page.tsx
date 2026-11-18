import Link from "next/link";
import { and, desc, eq, ilike, inArray, notInArray, or, type SQL } from "drizzle-orm";
import { ChevronLeft, MessageSquarePlus } from "lucide-react";
import { getDb, schema } from "@/server/db/client";
import { portalContext } from "@/server/portal/context";
import { STATUS_LABEL, TICKET_TABS, type TicketTab, categoryLabel, customerStatus, isTicketTab } from "@/lib/support";
import { CopyBtn } from "@/components/portal/orders/ui";
import { TicketFilter } from "@/components/portal/support/TicketFilter";

const when = (d: Date) => d.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true }).replace(/am|pm/, (m) => m.toUpperCase());
const TAB_LABEL: Record<TicketTab, string> = { open: "Open", resolved: "Resolved", closed: "Closed", all: "All" };

export default async function TicketsPage({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string }> }) {
  const sp = await searchParams;
  const tab: TicketTab = isTicketTab(sp.tab) ? sp.tab : "open";
  const q = (sp.q ?? "").trim().slice(0, 60);
  const ctx = await portalContext();
  const db = await getDb();
  const T = schema.tickets;
  const conds: SQL[] = [eq(T.orgId, ctx.org.id)];
  if (tab === "open") conds.push(notInArray(T.status, ["resolved", "closed"]));
  if (tab === "resolved") conds.push(inArray(T.status, ["resolved"]));
  if (tab === "closed") conds.push(inArray(T.status, ["closed"]));
  if (q) {
    const bare = q.replace(/^#/, "");
    const like = `%${bare.replace(/[%_\\]/g, "")}%`;
    conds.push(or(ilike(T.number, like), ilike(T.orderNumber, like), ilike(T.awb, like))!);
  }
  const rows = await db.select().from(T).where(and(...conds)).orderBy(desc(T.updatedAt)).limit(100);
  const qs = new URLSearchParams({ ...(tab !== "open" ? { tab } : {}), ...(q ? { q } : {}) }).toString();
  const back = qs ? `?back=${encodeURIComponent(qs)}` : "";
  const tabHref = (t: TicketTab) => { const p = new URLSearchParams({ ...(t !== "open" ? { tab: t } : {}), ...(q ? { q } : {}) }).toString(); return `/portal/support/${p ? `?${p}` : ""}`; };

  return (
    <div className="tk-page">
      <header className="tk-top">
        <Link href="/portal/" className="tk-back" aria-label="Back to dashboard"><ChevronLeft size={24} aria-hidden /></Link>
        <h1>Tickets</h1>
        <Link className="tk-raise" href={`/portal/support/new/${back}`}><MessageSquarePlus size={18} aria-hidden /> Raise Ticket</Link>
        <TicketFilter q={q} tab={tab} />
      </header>
      <nav className="tk-tabs" aria-label="Ticket status">
        {TICKET_TABS.map((t) => <Link key={t} href={tabHref(t)} className={`t-${t}${tab === t ? " on" : ""}`} aria-current={tab === t ? "page" : undefined}>{TAB_LABEL[t]}</Link>)}
      </nav>
      {q && <p className="small muted tk-qnote">Showing {TAB_LABEL[tab].toLowerCase()} tickets matching “{q}”. <Link href={`/portal/support/${tab !== "open" ? `?tab=${tab}` : ""}`} className="link">Clear</Link></p>}
      {rows.length === 0 ? (
        <div className="tk-empty">
          <p>{q ? `No ${tab === "all" ? "" : `${TAB_LABEL[tab].toLowerCase()} `}tickets match “${q}”.` : tab === "open" ? "You have no open tickets." : `No ${tab === "all" ? "" : `${TAB_LABEL[tab].toLowerCase()} `}tickets yet.`}</p>
          <Link className="tk-raise" href={`/portal/support/new/${back}`}><MessageSquarePlus size={18} aria-hidden /> Raise Ticket</Link>
        </div>
      ) : (
        <ul className="tk-list">
          {rows.map((t) => {
            const st = customerStatus(t.status);
            return (
              <li key={t.id} className="tk-card">
                <div className="tk-card-h"><b>#{t.number}</b><span className={`tk-st ${st}`}>{STATUS_LABEL[st]}</span></div>
                <div>{categoryLabel(t.category)}</div>
                <div>Order ID: {t.orderNumber ?? "--"}</div>
                <div className="tk-awb">AWB: {t.awb ? <><span className="tk-awbv">{t.awb}</span><CopyBtn value={t.awb} label="AWB" /></> : "--"}</div>
                <div className="tk-card-f">
                  <div className="small">Created: {when(t.createdAt)}<br />Updated: {when(t.updatedAt)}</div>
                  <Link className="tk-comment" href={`/portal/support/${t.id}/${back}`}>Add Comment</Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
