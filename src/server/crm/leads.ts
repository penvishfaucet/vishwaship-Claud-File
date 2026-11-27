import "server-only";
import { and, eq, inArray, isNotNull, notInArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { can, type StaffRole } from "@/server/auth/rbac";
import { newId } from "@/server/util/ids";
import { CLOSED_STATUSES, normMobile } from "@/lib/crm";

/**
 * Admin → CRM Leads. Leads come from Meta Lead Ads forms (see server/marketing/meta-leads.ts) or are added by staff.
 * Owner / managers (crm.manage) see and assign every lead; other staff with crm.read work only the leads assigned to them.
 */

export type Lead = typeof schema.crmLeads.$inferSelect;
type Staff = { userId: string; role: StaffRole };

export const isManager = (s: Staff) => can(s.role, "crm.manage");
export const canSee = (s: Staff, l: Pick<Lead, "assignedTo">) => isManager(s) || l.assignedTo === s.userId;

export async function getLead(id: string) {
  const db = await getDb();
  const [l] = await db.select().from(schema.crmLeads).where(eq(schema.crmLeads.id, id));
  return l ?? null;
}

/** Append to the lead's timeline; notes / calls / chats also become the "last conversation" shown in the list. */
export async function addActivity(leadId: string, kind: string, body: string | null, by: string | null, meta: Record<string, unknown> = {}) {
  const db = await getDb();
  await db.insert(schema.crmActivities).values({ id: newId("cra"), leadId, kind, body, meta, byUserId: by });
  const talk = ["note", "call", "whatsapp", "form"].includes(kind);
  await db.update(schema.crmLeads).set({
    lastActivityAt: new Date(), updatedAt: new Date(),
    ...(talk && body ? { lastNote: body.slice(0, 300) } : {}),
  }).where(eq(schema.crmLeads.id, leadId));
}

export type NewLead = {
  name: string; mobile?: string | null; email?: string | null; city?: string | null; company?: string | null;
  source?: string; campaign?: string | null; adName?: string | null; metaLeadId?: string | null;
  interest?: string | null; volume?: string | null; currentCourier?: string | null; answers?: Array<{ q: string; a: string }>;
  assignedTo?: string | null; nextFollowUpAt?: Date | null; preferredTime?: string | null; note?: string | null;
};

/** An open lead (not signed up / lost) with this mobile, so the same person is never two leads. */
export async function openLeadByMobile(mobile: string) {
  const db = await getDb();
  const [l] = await db.select().from(schema.crmLeads)
    .where(and(eq(schema.crmLeads.mobile, mobile), notInArray(schema.crmLeads.status, [...CLOSED_STATUSES]))).limit(1);
  return l ?? null;
}

export async function createLead(input: NewLead, by: string | null): Promise<{ id: string; existing: boolean }> {
  const mobile = input.mobile ? normMobile(input.mobile) : null;
  if (mobile) {
    const ex = await openLeadByMobile(mobile);
    if (ex) return { id: ex.id, existing: true };
  }
  const db = await getDb();
  const id = newId("lead", 12);
  await db.insert(schema.crmLeads).values({
    id, name: input.name.trim().slice(0, 120) || "Unknown", mobile, email: input.email?.trim() || null, city: input.city?.trim() || null,
    company: input.company?.trim() || null, source: input.source ?? "manual", campaign: input.campaign ?? null, adName: input.adName ?? null,
    metaLeadId: input.metaLeadId ?? null, interest: input.interest?.trim() || null, volume: input.volume?.trim() || null,
    currentCourier: input.currentCourier?.trim() || null, answers: input.answers ?? [], assignedTo: input.assignedTo || null,
    nextFollowUpAt: input.nextFollowUpAt ?? null, preferredTime: input.preferredTime?.trim() || null, createdBy: by,
    lastActivityAt: new Date(),
  }).onConflictDoNothing();
  await addActivity(id, "created", null, by, { source: input.source ?? "manual" });
  if (input.note?.trim()) await addActivity(id, "note", input.note.trim(), by);
  return { id, existing: false };
}

// ---------- Meta Lead Ads ----------
type FieldData = Array<{ name: string; values?: string[] }>;
export type MetaLead = {
  id: string; created_time?: string; field_data?: FieldData; ad_name?: string; adset_name?: string; campaign_name?: string;
  form_id?: string; platform?: string; is_organic?: boolean;
};

const tidy = (s: string) => s.replace(/_/g, " ").trim();
const pretty = (k: string) => k.replace(/[_?]+/g, " ").replace(/\s+/g, " ").trim();

/** Form answers → lead fields. Every answer is also kept as asked. */
export function fromMetaLead(l: MetaLead): NewLead {
  const out: NewLead = { name: "", source: "meta_form", metaLeadId: l.id, campaign: l.campaign_name ?? (l.is_organic ? "Organic (no ad)" : null), adName: l.ad_name ?? null, answers: [] };
  for (const f of l.field_data ?? []) {
    const val = tidy((f.values ?? []).join(", "));
    if (!val) continue;
    out.answers!.push({ q: pretty(f.name), a: val });
    const k = f.name.toLowerCase();
    if (k === "full_name" || k === "first_name" || k === "name") out.name = out.name ? `${out.name} ${val}` : val;
    else if (k === "last_name") out.name = `${out.name} ${val}`.trim();
    else if (k === "phone_number" || k === "phone" || /whatsapp|mobile/.test(k)) out.mobile = val;
    else if (k === "email") out.email = val;
    else if (k === "city") out.city = val;
    else if (/company|business|firm/.test(k)) out.company = val;
    else if (/monthly|volume|orders|kitne/.test(k)) out.volume = val;
    else if (/sell|ship|product|bech/.test(k)) out.interest = val;
    else if (/courier/.test(k)) out.currentCourier = val;
  }
  if (l.platform) out.answers!.push({ q: "Platform", a: l.platform === "ig" ? "Instagram" : l.platform === "fb" ? "Facebook" : l.platform });
  if (!out.name) out.name = out.mobile ?? "Meta lead";
  return out;
}

/** Store one Meta lead (idempotent by lead ID). The same mobile again → a timeline entry on the existing lead. */
export async function ingestMetaLead(l: MetaLead): Promise<{ id: string; created: boolean }> {
  const db = await getDb();
  const [dup] = await db.select({ id: schema.crmLeads.id }).from(schema.crmLeads).where(eq(schema.crmLeads.metaLeadId, l.id));
  if (dup) return { id: dup.id, created: false };
  const nl = fromMetaLead(l);
  const summary = `Form filled${nl.campaign ? ` — ${nl.campaign}` : ""}: ${(nl.answers ?? []).map((a) => `${a.q}: ${a.a}`).join(" · ")}`.slice(0, 1000);
  const mobile = nl.mobile ? normMobile(nl.mobile) : null;
  const ex = mobile ? await openLeadByMobile(mobile) : null;
  if (ex) {
    await db.insert(schema.crmActivities).values({ id: newId("cra"), leadId: ex.id, kind: "form", body: summary, meta: { metaLeadId: l.id, repeat: true }, byUserId: null });
    await db.update(schema.crmLeads).set({ lastActivityAt: new Date(), updatedAt: new Date(), lastNote: summary.slice(0, 300) }).where(eq(schema.crmLeads.id, ex.id));
    return { id: ex.id, created: false };
  }
  const r = await createLead(nl, null);
  await db.insert(schema.crmActivities).values({ id: newId("cra"), leadId: r.id, kind: "form", body: summary, meta: { metaLeadId: l.id }, byUserId: null });
  await db.update(schema.crmLeads).set({ lastNote: summary.slice(0, 300) }).where(eq(schema.crmLeads.id, r.id));
  return { id: r.id, created: true };
}

/** Leads whose mobile has since signed up as a customer → Signed up, linked to the account. */
export async function sweepSignedUp() {
  const db = await getDb();
  const rows = await db.select({ id: schema.crmLeads.id, orgId: schema.users.orgId }).from(schema.crmLeads)
    .innerJoin(schema.users, and(eq(schema.users.kind, "customer"), eq(schema.users.mobile, schema.crmLeads.mobile)))
    .where(and(isNotNull(schema.crmLeads.mobile), notInArray(schema.crmLeads.status, ["signed_up"]), sql`${schema.crmLeads.orgId} is null`)).limit(50);
  for (const r of rows) {
    await db.update(schema.crmLeads).set({ status: "signed_up", orgId: r.orgId, updatedAt: new Date() }).where(eq(schema.crmLeads.id, r.id));
    await addActivity(r.id, "status", "Signed up on Vishwaship (same mobile) — marked Signed up automatically", null, { to: "signed_up", auto: true });
  }
  return rows.length;
}

/** Active staff who can be given leads (CRM access). */
export async function crmStaff() {
  const db = await getDb();
  const all = await db.select({ id: schema.users.id, name: schema.users.name, role: schema.users.staffRole }).from(schema.users)
    .where(and(eq(schema.users.kind, "staff"), eq(schema.users.active, true)));
  return all.filter((u) => can(u.role as StaffRole, "crm.read"));
}

export async function staffNames(ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const db = await getDb();
  const r = await db.select({ id: schema.users.id, name: schema.users.name }).from(schema.users).where(inArray(schema.users.id, ids));
  return new Map(r.map((u) => [u.id, u.name]));
}
