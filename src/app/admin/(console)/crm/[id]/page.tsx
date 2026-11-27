import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { AdminOpForm } from "@/components/admin/AdminOpForm";
import { CrmWhatsAppComposer } from "@/components/admin/CrmWhatsApp";
import { requireStaff } from "@/server/auth/session";
import { canSee, crmStaff, getLead, isManager, staffNames } from "@/server/crm/leads";
import { getDb, schema } from "@/server/db/client";
import { ACTIVITY_LABEL, LEAD_STATUSES, SOURCE_LABEL, STATUS_LABEL, type LeadStatus, istInput, istShort } from "@/lib/crm";

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
            <h2 id="h-wa">WhatsApp / Call</h2>
            {l.mobile ? <CrmWhatsAppComposer id={l.id} mobile={l.mobile} name={l.name} b2b={b2b} /> : <p className="small muted">No mobile number — add it under Details.</p>}
          </section>

          <section className="card crm-box" aria-labelledby="h-log">
            <h2 id="h-log">Log the conversation</h2>
            <p className="tiny muted" style={{ marginTop: 0 }}>What was said, what they want, when to call back — everyone on the team sees it here.</p>
            <AdminOpForm endpoint="/api/admin/crm" op="log" extra={{ id: l.id }} submit="Save" resetOnSuccess fields={[
              { name: "kind", label: "Type", type: "select", value: "call", options: [["call", "Call"], ["whatsapp", "WhatsApp chat"], ["note", "Note"]] },
              { name: "followUp", label: "Next follow-up (optional)", type: "datetime-local" },
              { name: "body", label: "What happened", type: "textarea", placeholder: "e.g. 150 orders/month, uses Delhivery, wants COD D+5. Call back Monday evening." },
            ]} />
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
