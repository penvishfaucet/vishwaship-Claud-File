import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/server/audit";
import { apiStaff } from "@/server/auth/session";
import { addActivity, canSee, createLead, crmStaff, getLead, isManager } from "@/server/crm/leads";
import { getDb, schema } from "@/server/db/client";
import { apiError, parseJson } from "@/server/http";
import { LEAD_SOURCES, STATUS_LABEL, WA_TEMPLATES, fromIstInput, isLeadStatus, istShort, normMobile } from "@/lib/crm";

const str = (max: number) => z.string().max(max).optional().default("");
const Body = z.discriminatedUnion("op", [
  z.object({ op: z.literal("create"), name: z.string().min(1).max(120), mobile: str(20), email: str(120), city: str(80), company: str(120), source: str(20), interest: str(300), volume: str(80), preferredTime: str(120), followUp: str(20), note: str(2000), assignedTo: str(40) }),
  z.object({ op: z.literal("update"), id: z.string().max(40), name: z.string().min(1).max(120), mobile: str(20), email: str(120), city: str(80), company: str(120), interest: str(300), volume: str(80), currentCourier: str(120), preferredTime: str(120) }),
  z.object({ op: z.literal("status"), id: z.string().max(40), status: z.string().max(20), note: str(2000) }),
  z.object({ op: z.literal("assign"), id: z.string().max(40), assignedTo: str(40) }),
  z.object({ op: z.literal("followup"), id: z.string().max(40), at: str(20), preferredTime: str(120), note: str(2000) }),
  z.object({ op: z.literal("log"), id: z.string().max(40), kind: z.enum(["note", "call", "whatsapp"]), body: z.string().min(1).max(2000), followUp: str(20) }),
  z.object({ op: z.literal("wa_open"), id: z.string().max(40), template: str(20) }),
]);

/** Admin → CRM Leads. crm.read works the caller's own leads; crm.manage works every lead and assigns them. */
export async function POST(req: Request) {
  const p = await parseJson(req, Body);
  if (!p.ok) return p.res;
  const s = await apiStaff("crm.read");
  if (!s) return apiError(403, "forbidden", "You don't have access to CRM Leads");
  const b = p.data;
  const db = await getDb();
  const L = schema.crmLeads;
  const okStaff = async (id: string) => !id || (await crmStaff()).some((u) => u.id === id);

  if (b.op === "create") {
    if (b.mobile && !/^\+?[\d\s-]{8,16}$/.test(b.mobile)) return apiError(422, "validation_error", "Enter a valid mobile number");
    const assignedTo = isManager(s) ? b.assignedTo : s.userId; // staff's own leads are theirs
    if (!(await okStaff(assignedTo))) return apiError(422, "validation_error", "Pick a staff member with CRM access");
    const at = b.followUp ? fromIstInput(b.followUp) : null;
    const r = await createLead({ name: b.name, mobile: b.mobile || null, email: b.email, city: b.city, company: b.company, source: (LEAD_SOURCES as readonly string[]).includes(b.source) ? b.source : "manual", interest: b.interest, volume: b.volume, preferredTime: b.preferredTime, nextFollowUpAt: at, note: b.note, assignedTo: assignedTo || null }, s.userId);
    if (r.existing) return apiError(409, "exists", `This mobile is already an open lead — open it: /admin/crm/${r.id}/`);
    await audit({ actorUserId: s.userId, actorKind: "staff", action: "crm.lead_created", targetType: "crm_lead", targetId: r.id, details: {} });
    return NextResponse.json({ ok: true, id: r.id, message: "Lead added" });
  }

  const lead = await getLead(b.id);
  if (!lead || !canSee(s, lead)) return apiError(404, "not_found", "Lead not found");

  if (b.op === "update") {
    const mobile = b.mobile ? normMobile(b.mobile) : null;
    await db.update(L).set({ name: b.name.trim(), mobile, email: b.email.trim() || null, city: b.city.trim() || null, company: b.company.trim() || null, interest: b.interest.trim() || null, volume: b.volume.trim() || null, currentCourier: b.currentCourier.trim() || null, preferredTime: b.preferredTime.trim() || null, updatedAt: new Date() }).where(eq(L.id, lead.id));
    return NextResponse.json({ ok: true, message: "Details saved" });
  }
  if (b.op === "status") {
    if (!isLeadStatus(b.status)) return apiError(422, "validation_error", "Unknown status");
    if (b.status === lead.status && !b.note) return NextResponse.json({ ok: true, message: "No change" });
    const closed = ["signed_up", "not_interested", "lost"].includes(b.status);
    await db.update(L).set({ status: b.status, ...(closed ? { nextFollowUpAt: null } : {}), updatedAt: new Date() }).where(eq(L.id, lead.id));
    await addActivity(lead.id, "status", `${STATUS_LABEL[lead.status as keyof typeof STATUS_LABEL] ?? lead.status} → ${STATUS_LABEL[b.status]}${b.note ? ` — ${b.note}` : ""}`, s.userId, { from: lead.status, to: b.status });
    if (b.note) await addActivity(lead.id, "note", b.note, s.userId);
    return NextResponse.json({ ok: true, message: `Status: ${STATUS_LABEL[b.status]}` });
  }
  if (b.op === "assign") {
    if (!isManager(s)) return apiError(403, "forbidden", "Only the owner / a CRM manager can assign leads");
    if (!(await okStaff(b.assignedTo))) return apiError(422, "validation_error", "Pick a staff member with CRM access");
    const name = b.assignedTo ? (await crmStaff()).find((u) => u.id === b.assignedTo)?.name : null;
    await db.update(L).set({ assignedTo: b.assignedTo || null, updatedAt: new Date() }).where(eq(L.id, lead.id));
    await addActivity(lead.id, "assign", name ? `Assigned to ${name}` : "Unassigned", s.userId, { to: b.assignedTo || null });
    await audit({ actorUserId: s.userId, actorKind: "staff", action: "crm.lead_assigned", targetType: "crm_lead", targetId: lead.id, details: { to: b.assignedTo || null } });
    return NextResponse.json({ ok: true, message: name ? `Assigned to ${name}` : "Unassigned" });
  }
  if (b.op === "followup") {
    const at = b.at ? fromIstInput(b.at) : null;
    if (b.at && !at) return apiError(422, "validation_error", "Pick a valid date and time");
    await db.update(L).set({ nextFollowUpAt: at, preferredTime: b.preferredTime.trim() || lead.preferredTime, ...(at && lead.status === "new" ? { status: "follow_up" } : {}), updatedAt: new Date() }).where(eq(L.id, lead.id));
    await addActivity(lead.id, "follow_up", `${at ? `Next follow-up: ${istShort(at)}` : "Follow-up cleared"}${b.preferredTime ? ` · Best time: ${b.preferredTime}` : ""}${b.note ? ` — ${b.note}` : ""}`, s.userId, { at: at?.toISOString() ?? null });
    return NextResponse.json({ ok: true, message: at ? `Follow-up set for ${istShort(at)}` : "Follow-up cleared" });
  }
  if (b.op === "log") {
    const label = { note: "", call: "📞 Call: ", whatsapp: "💬 WhatsApp: " }[b.kind];
    await addActivity(lead.id, b.kind, `${label}${b.body.trim()}`, s.userId);
    const at = b.followUp ? fromIstInput(b.followUp) : null;
    if (at) {
      await db.update(L).set({ nextFollowUpAt: at, updatedAt: new Date() }).where(eq(L.id, lead.id));
      await addActivity(lead.id, "follow_up", `Next follow-up: ${istShort(at)}`, s.userId, { at: at.toISOString() });
    }
    if (lead.status === "new" && b.kind !== "note") await db.update(L).set({ status: at ? "follow_up" : "contacted" }).where(eq(L.id, lead.id));
    return NextResponse.json({ ok: true, message: "Saved to the timeline" });
  }
  // wa_open: the WhatsApp chat was opened from the CRM (the message itself is sent from the staff member's WhatsApp)
  const t = WA_TEMPLATES.find((x) => x.key === b.template);
  await addActivity(lead.id, "whatsapp", `💬 WhatsApp chat opened${t && t.key !== "blank" ? ` — “${t.label}” message` : ""}`, s.userId, { template: b.template });
  if (lead.status === "new") await db.update(L).set({ status: "contacted", updatedAt: new Date() }).where(eq(L.id, lead.id));
  return NextResponse.json({ ok: true });
}
