import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { AdminOpForm } from "@/components/admin/AdminOpForm";
import { CrmWhatsAppComposer } from "@/components/admin/CrmWhatsApp";
import { CrmDeleteLead } from "@/components/admin/CrmDeleteLead";
import { requireStaff } from "@/server/auth/session";
import { canSee, crmStaff, getLead, isManager, staffNames } from "@/server/crm/leads";
import { getDb, schema } from "@/server/db/client";
import { ACTIVITY_LABEL, CALL_OUTCOMES, LEAD_STATUSES, SOURCE_LABEL, STATUS_LABEL, type LeadStatus, callOutcome, istInput, istShort } from "@/lib/crm";
import { CrmWaChat, type ChatMsg, type TemplateOpt } from "@/components/admin/CrmWaChat";
import { type CrmWaMedia, MEDIA_SETTING, WA_WINDOW_MS, approvedTemplates, crmWaConfig, markSeen, windowOpen } from "@/server/crm/whatsapp";
import { getSetting } from "@/server/quotes/service";

export const dynamic = "force-dynamic";
export const metadata = { title: "Lead — CRM — Vishwaship Admin" };

/** One lead: WhatsApp / call, log the conversation, next follow-up, status, owner, details and the full timeline. */
export default async function CrmLead({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = await requireStaff("crm.read");
  const l = await getLead(id);
  if (!l || !canSee(s, l)) notFound();
  const manager = isManager(s);
  const db = await getDb();
  const acts = await db.select().from(schema.crmActivities).where(eq(schema.crmActivities.leadId, l.id)).orderBy(asc(schema.crmActivities.createdAt));
  const names = await staffNames([...new Set([l.assignedTo, ...acts.map((a) => a.byUserId)].filter(Boolean) as string[])]);
  const staff = manager ? await crmStaff() : [];
  const answers = (l.answers as Array<{ q: string; a: string }>) ?? [];
  const b2b = /b2b|cargo/i.test(`${l.campaign ?? ""} ${l.interest ?? ""}`);
  const overdue = l.nextFollowUpAt && l.nextFollowUpAt < new Date();

  // WhatsApp for CRM (Cloud API): the chat with this lead and the approved templates
  const wa = await crmWaConfig();
  const tl = wa && l.mobile ? await approvedTemplates(wa).catch((e: Error) => ({ ok: false as const, message: e.message })) : null;
  const mediaMap = wa ? (await getSetting<CrmWaMedia>(MEDIA_SETTING, {})).value : {};
  const templates: TemplateOpt[] = tl?.ok ? tl.templates.map((t) => ({ name: t.name, language: t.language, header: t.header, body: t.body, vars: t.vars, buttons: t.buttons, mediaUrl: mediaMap[t.name]?.url ?? "" })) : [];
  const chat: ChatMsg[] = acts.filter((a) => a.kind === "wa_in" || a.kind === "wa_out" || a.kind === "whatsapp").map((a) => {
    const m = (a.meta as Record<string, unknown>) ?? {};
    return { id: a.id, dir: a.kind === "wa_in" ? "in" : a.kind === "wa_out" ? "out" : "manual", text: a.body ?? "", at: a.createdAt.toISOString(),
      status: (m.status as string) ?? null, error: (m.error as string) ?? null, mediaType: (m.mediaType as string) ?? null, mediaUrl: (m.mediaUrl as string) ?? null,
      by: a.byUserId ? names.get(a.byUserId) ?? "Staff" : null };
  });
  if (l.waUnread > 0) await markSeen(l.id);
  const firstTemplate = templates.find((t) => (b2b ? /b2b|cargo/i : /intro|welcome|pehla/i).test(t.name))?.name;

  return (
    <>
      <p className="small"><Link className="link" href="/admin/crm/">← CRM Leads</Link></p>
      <div className="page-h crm-head"><div>
        <h1>{l.name} <span className={`crm-st st-${l.status}`}>{STATUS_LABEL[l.status as LeadStatus] ?? l.status}</span></h1>
        <p className="small muted" style={{ margin: "4px 0 0" }}>
          {SOURCE_LABEL[l.source] ?? l.source}{l.campaign ? ` · ${l.campaign}` : ""}{l.adName ? ` · ad ${l.adName}` : ""} · added {istShort(l.createdAt)} · {l.assignedTo ? `Owner: ${names.get(l.assignedTo) ?? "Staff"}` : "Unassigned"}
          {l.orgId && <> · <Link className="link" href={`/admin/customers/${l.orgId}/`}>Customer account →</Link></>}
        </p>
      </div></div>

      <div className="crm-grid">
        <div className="col" style={{ gap: 12 }}>
          <section className="card crm-box" aria-labelledby="h-wa">
            <h2 id="h-wa">WhatsApp / Call{l.lastWaInAt && <span className="tiny muted" style={{ fontWeight: 400 }}> · last reply {istShort(l.lastWaInAt)}</span>}</h2>
            {!l.mobile ? <p className="small muted">No mobile number — add it under Details.</p>
              : wa ? <CrmWaChat id={l.id} mobile={l.mobile} name={l.name} chat={chat} templates={templates} templatesError={tl && !tl.ok ? tl.message : undefined}
                  windowOpen={windowOpen(l.lastWaInAt)} windowEndsAt={l.lastWaInAt ? new Date(l.lastWaInAt.getTime() + WA_WINDOW_MS).toISOString() : null} firstTemplate={firstTemplate} />
              : <>
                  <CrmWhatsAppComposer id={l.id} mobile={l.mobile} name={l.name} b2b={b2b} />
                  {manager && <p className="tiny muted" style={{ margin: "8px 0 0" }}>To send the intro with photo / video in one click and see replies here, connect <Link className="link" href="/admin/services/">WhatsApp for CRM Leads</Link> in API Keys &amp; Services.</p>}
                </>}
          </section>

          <section className="card crm-box" aria-labelledby="h-log">
            <h2 id="h-log">Log the conversation</h2>
            <p className="tiny muted" style={{ marginTop: 0 }}>Call result, what was said, when to call back — everyone on the team sees it here. No answer / busy without a date → follow-up tomorrow 11 AM.</p>
            <AdminOpForm endpoint="/api/admin/crm" op="log" extra={{ id: l.id }} submit="Save" resetOnSuccess fields={[
              { name: "kind", label: "Type", type: "select", value: "call", options: [["call", "Call"], ["whatsapp", "WhatsApp chat"], ["note", "Note"]] },
              { name: "outcome", label: "Call result", type: "select", value: "", options: [["", "— (for calls) —"], ...CALL_OUTCOMES.map((o) => [o.key, o.label] as [string, string])] },
              { name: "followUp", label: "Next follow-up (optional)", type: "datetime-local" },
              { name: "body", label: "What happened", type: "textarea", placeholder: "e.g. 150 orders/month, uses Delhivery, wants COD D+5. Call back Monday evening." },
            ]} />
            {l.lastCallOutcome && <p className="tiny muted" style={{ margin: "6px 0 0" }}>Last call: <b>{callOutcome(l.lastCallOutcome)?.label ?? l.lastCallOutcome}</b></p>}
          </section>

          <section className="card crm-box" aria-labelledby="h-tl">
            <h2 id="h-tl">Timeline</h2>
            <ol className="crm-tl">
              {[...acts].reverse().map((a) => (
                <li key={a.id} className={`k-${a.kind}`}>
                  <div className="tiny muted"><b>{ACTIVITY_LABEL[a.kind] ?? a.kind}</b> · {istShort(a.createdAt)} · {a.byUserId ? names.get(a.byUserId) ?? "Staff" : "System"}</div>
                  {a.body && <div className="small" style={{ whiteSpace: "pre-wrap" }}>{a.body}</div>}
                </li>
              ))}
            </ol>
          </section>
        </div>

        <div className="col" style={{ gap: 12 }}>
          <section className="card crm-box" aria-labelledby="h-fu">
            <h2 id="h-fu">Next follow-up</h2>
            <p className="small" style={{ marginTop: 0 }}>{l.nextFollowUpAt ? <b className={overdue ? "red" : ""}>⏰ {istShort(l.nextFollowUpAt)}{overdue ? " (due)" : ""}</b> : <span className="muted">Not set</span>}{l.preferredTime && <span className="muted"> · Best time: {l.preferredTime}</span>}</p>
            <AdminOpForm key={`fu-${l.nextFollowUpAt?.toISOString() ?? ""}-${l.preferredTime ?? ""}`} endpoint="/api/admin/crm" op="followup" extra={{ id: l.id }} submit="Set follow-up" fields={[
              { name: "at", label: "Date & time", type: "datetime-local", value: l.nextFollowUpAt ? istInput(l.nextFollowUpAt) : "" },
              { name: "preferredTime", label: "Best time they gave", value: l.preferredTime ?? "", placeholder: "e.g. after 7 PM, Sunday" },
              { name: "note", label: "Note (optional)", type: "textarea" },
            ]} />
          </section>

          <section className="card crm-box" aria-labelledby="h-st">
            <h2 id="h-st">Status</h2>
            <AdminOpForm key={`st-${l.status}`} endpoint="/api/admin/crm" op="status" extra={{ id: l.id }} submit="Update" fields={[
              { name: "status", label: "Status", type: "select", value: l.status, options: LEAD_STATUSES.map((x) => [x, STATUS_LABEL[x]] as [string, string]) },
              { name: "note", label: "Reason / note (optional)", type: "textarea" },
            ]} />
          </section>

          {manager && (
            <section className="card crm-box" aria-labelledby="h-as">
              <h2 id="h-as">Assign to staff</h2>
              <AdminOpForm key={`as-${l.assignedTo ?? ""}`} endpoint="/api/admin/crm" op="assign" extra={{ id: l.id }} submit="Assign" fields={[
                { name: "assignedTo", label: "Staff member", type: "select", value: l.assignedTo ?? "", options: [["", "— Unassigned —"], ...staff.map((u) => [u.id, `${u.name} (${u.role})`] as [string, string])] },
              ]} />
              <p className="tiny muted" style={{ margin: "6px 0 0" }}>Add staff in <Link className="link" href="/admin/staff/">Staff &amp; Roles</Link> — role <b>sales</b> sees only CRM Leads assigned to them.</p>
            </section>
          )}

          {manager && (
            <section className="card crm-box" aria-labelledby="h-del">
              <h2 id="h-del">Delete lead</h2>
              <p className="tiny muted" style={{ marginTop: 0 }}>For test or junk entries only. The lead and its whole timeline are removed for good (recorded in the Audit Log). For a real person who said no, set the status to Not interested / Lost instead.</p>
              <CrmDeleteLead id={l.id} name={l.name} />
            </section>
          )}

          <section className="card crm-box" aria-labelledby="h-dt">
            <h2 id="h-dt">Details</h2>
            {answers.length > 0 && (
              <dl className="crm-answers small">
                {answers.map((a, i) => <div key={i}><dt className="muted">{a.q}</dt><dd>{a.a}</dd></div>)}
              </dl>
            )}
            <AdminOpForm endpoint="/api/admin/crm" op="update" extra={{ id: l.id }} submit="Save details" fields={[
              { name: "name", label: "Name", value: l.name, required: true },
              { name: "mobile", label: "Mobile", type: "tel", value: l.mobile ?? "" },
              { name: "email", label: "Email", type: "email", value: l.email ?? "" },
              { name: "city", label: "City", value: l.city ?? "" },
              { name: "company", label: "Business / company", value: l.company ?? "" },
              { name: "interest", label: "What they sell / ship", value: l.interest ?? "" },
              { name: "volume", label: "Monthly orders / volume", value: l.volume ?? "" },
              { name: "currentCourier", label: "Current courier", value: l.currentCourier ?? "" },
              { name: "preferredTime", label: "Best time to talk", value: l.preferredTime ?? "" },
            ]} />
          </section>
        </div>
      </div>
    </>
  );
}
