import Link from "next/link";
import { type SQL, and, asc, count, desc, eq, ilike, inArray, isNotNull, isNull, lte, notInArray, or, sql } from "drizzle-orm";
import { AdminOpForm } from "@/components/admin/AdminOpForm";
import { CrmQuickActions } from "@/components/admin/CrmWhatsApp";
import { AutoRefresh } from "@/components/portal/AutoRefresh";
import { requireStaff } from "@/server/auth/session";
import { crmStaff, isManager, staffNames } from "@/server/crm/leads";
import { getDb, schema } from "@/server/db/client";
import { CLOSED_STATUSES, LEAD_SOURCES, LEAD_STATUSES, SOURCE_LABEL, STATUS_LABEL, type LeadStatus, istShort } from "@/lib/crm";

export const dynamic = "force-dynamic";
export const metadata = { title: "CRM Leads — Vishwaship Admin" };

const TABS = [
  ["due", "Follow-up due"], ["new", "New"], ["open", "All open"], ["won", "Signed up"], ["closed", "Lost / not interested"], ["all", "All"],
] as const;
type Tab = (typeof TABS)[number][0];

/** Admin → CRM Leads: every enquiry (Meta ad forms come in automatically), worked with WhatsApp / call, notes and follow-ups. */
export default async function CrmLeads({ searchParams }: { searchParams: Promise<{ tab?: string; q?: string; who?: string; src?: string }> }) {
  const sp = await searchParams;
  const s = await requireStaff("crm.read");
  const manager = isManager(s);
  const tab: Tab = TABS.some(([k]) => k === sp.tab) ? (sp.tab as Tab) : "open";
  const q = (sp.q ?? "").trim().slice(0, 60);
  const who = manager ? (sp.who ?? "") : "me";
  const src = (LEAD_SOURCES as readonly string[]).includes(sp.src ?? "") ? sp.src! : "";
  const db = await getDb();
  const L = schema.crmLeads;
  const now = new Date();
  const endOfDay = new Date(Math.ceil((now.getTime() + 5.5 * 3600_000) / 86400_000) * 86400_000 - 5.5 * 3600_000);

  const scope: SQL[] = [];
  if (who === "me") scope.push(eq(L.assignedTo, s.userId));
  else if (who === "none") scope.push(isNull(L.assignedTo));
  else if (who) scope.push(eq(L.assignedTo, who));
  if (src) scope.push(eq(L.source, src));
  if (q) { const like = `%${q.replace(/[%_\\]/g, "")}%`; scope.push(or(ilike(L.name, like), ilike(L.mobile, like), ilike(L.city, like), ilike(L.company, like), ilike(L.interest, like))!); }
  const open = notInArray(L.status, [...CLOSED_STATUSES]);
  const tabCond: Record<Tab, SQL | undefined> = {
    due: and(open, isNotNull(L.nextFollowUpAt), lte(L.nextFollowUpAt, endOfDay)),
    new: eq(L.status, "new"),
    open,
    won: eq(L.status, "signed_up"),
    closed: inArray(L.status, ["not_interested", "lost"]),
    all: undefined,
  };
  const rows = await db.select().from(L).where(and(...scope, tabCond[tab]))
    .orderBy(...(tab === "due" ? [asc(L.nextFollowUpAt)] : [desc(sql`coalesce(${L.lastActivityAt}, ${L.createdAt})`)])).limit(300);
  const counts = Object.fromEntries(await Promise.all(TABS.map(async ([k]) => {
    const [c] = await db.select({ n: count() }).from(L).where(and(...scope, tabCond[k]));
    return [k, Number(c.n)] as const;
  })));
  const staff = await crmStaff();
  const names = await staffNames([...new Set(rows.map((r) => r.assignedTo).filter(Boolean) as string[])]);
  const qs = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams({ ...(tab !== "open" ? { tab } : {}), ...(q ? { q } : {}), ...(manager && who ? { who } : {}), ...(src ? { src } : {}) });
    for (const [k, v] of Object.entries(patch)) { if (v) p.set(k, v); else p.delete(k); }
    const x = p.toString();
    return `/admin/crm/${x ? `?${x}` : ""}`;
  };
  const staffOpts: Array<[string, string]> = [["", manager ? "— Unassigned —" : "Me"], ...staff.map((u) => [u.id, u.name] as [string, string])];

  return (
    <>
      <AutoRefresh active everyMs={60_000} />
      <div className="page-h"><div>
        <h1>CRM Leads</h1>
        <p className="small muted" style={{ margin: "4px 0 0" }}>{manager ? "Every enquiry in one place. Meta ad-form leads arrive automatically; add WhatsApp / call enquiries with “Add lead”." : "The leads assigned to you."} Tap WhatsApp to open the chat with a ready message.</p>
      </div></div>

      <details className="card crm-add mb12">
        <summary className="b">+ Add lead</summary>
        <AdminOpForm endpoint="/api/admin/crm" op="create" submit="Add lead" resetOnSuccess fields={[
          { name: "name", label: "Name", required: true },
          { name: "mobile", label: "Mobile / WhatsApp", type: "tel", placeholder: "10-digit mobile" },
          { name: "city", label: "City" },
          { name: "company", label: "Business / company" },
          { name: "source", label: "Source", type: "select", value: "whatsapp", options: LEAD_SOURCES.filter((x) => x !== "meta_form").map((x) => [x, SOURCE_LABEL[x]] as [string, string]) },
          { name: "interest", label: "What they sell / ship", wide: true },
          { name: "volume", label: "Monthly orders / volume" },
          { name: "preferredTime", label: "Best time to talk", placeholder: "e.g. Evening 6–8 PM" },
          { name: "followUp", label: "Next follow-up", type: "datetime-local" },
          ...(manager ? [{ name: "assignedTo", label: "Assign to", type: "select" as const, value: "", options: staffOpts }] : []),
          { name: "note", label: "First conversation / note", type: "textarea" },
        ]} />
      </details>

      <div className="row wrap" style={{ gap: 8, marginBottom: 10 }}>
        <nav className="seg-tabs crm-tabs" aria-label="Lead filter">
          {TABS.map(([k, label]) => <a key={k} href={qs({ tab: k === "open" ? undefined : k })} className={tab === k ? "on" : ""} aria-current={tab === k ? "page" : undefined}>{label} <span className="crm-n">{counts[k]}</span></a>)}
        </nav>
      </div>
      <form className="row wrap crm-filters" style={{ gap: 6, marginBottom: 12 }} action="/admin/crm/" role="search">
        {tab !== "open" && <input type="hidden" name="tab" value={tab} />}
        <label className="sr-only" htmlFor="crq">Search leads</label>
        <input id="crq" name="q" defaultValue={q} className="input" placeholder="Name, mobile, city, business" style={{ minWidth: 200, flex: 1 }} />
        {manager && <><label className="sr-only" htmlFor="crw">Assigned to</label><select id="crw" name="who" className="select" defaultValue={who}>
          <option value="">Everyone</option><option value="me">Mine</option><option value="none">Unassigned</option>
          {staff.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select></>}
        <label className="sr-only" htmlFor="crs">Source</label>
        <select id="crs" name="src" className="select" defaultValue={src}><option value="">All sources</option>{LEAD_SOURCES.map((x) => <option key={x} value={x}>{SOURCE_LABEL[x]}</option>)}</select>
        <button className="btn btn-sm btn-navy">Filter</button>
      </form>

      {rows.length === 0 ? <p className="card small muted" style={{ padding: 16 }}>No leads here{q ? ` for “${q}”` : ""}.</p> : (
        <ul className="crm-list plain-list">
          {rows.map((l) => {
            const overdue = l.nextFollowUpAt && l.nextFollowUpAt < now && !(CLOSED_STATUSES as readonly string[]).includes(l.status);
            return (
              <li key={l.id} className={`card crm-card${overdue ? " crm-overdue" : ""}`}>
                <div className="crm-card-h">
                  <Link href={`/admin/crm/${l.id}/`} className="crm-name">{l.name}</Link>
                  <span className={`crm-st st-${l.status}`}>{STATUS_LABEL[l.status as LeadStatus] ?? l.status}</span>
                </div>
                <div className="tiny muted">{SOURCE_LABEL[l.source] ?? l.source}{l.campaign ? ` · ${l.campaign}` : ""} · added {istShort(l.createdAt)}</div>
                <div className="small crm-facts">
                  {l.mobile && <span className="mono">{l.mobile}</span>}
                  {l.city && <span>{l.city}</span>}
                  {l.company && <span>{l.company}</span>}
                  {l.interest && <span>{l.interest}</span>}
                  {l.volume && <span>{l.volume}</span>}
                </div>
                {l.lastNote && <p className="small crm-last">{l.lastNote}</p>}
                <div className="crm-card-f">
                  <span className="tiny">
                    {l.nextFollowUpAt && <b className={overdue ? "red" : ""}>⏰ {istShort(l.nextFollowUpAt)}</b>}
                    {l.preferredTime && <span className="muted"> · best: {l.preferredTime}</span>}
                    <span className="muted"> · {l.assignedTo ? names.get(l.assignedTo) ?? "Staff" : "Unassigned"}</span>
                  </span>
                  <span className="row" style={{ gap: 6 }}>
                    {l.mobile && <CrmQuickActions id={l.id} mobile={l.mobile} name={l.name} template={l.status === "new" ? (/b2b|cargo/i.test(l.campaign ?? "") ? "b2b" : "intro") : "followup"} />}
                    <Link className="btn btn-sm btn-navy" href={`/admin/crm/${l.id}/`}>Open</Link>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="tiny muted mt16">Statuses: {LEAD_STATUSES.map((x) => STATUS_LABEL[x]).join(" → ")}. A lead whose mobile signs up on Vishwaship becomes “Signed up” automatically.</p>
    </>
  );
}
