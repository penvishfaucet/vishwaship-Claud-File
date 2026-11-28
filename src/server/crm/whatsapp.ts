import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { activeService } from "@/server/integrations/services";
import { safeFetch } from "@/server/security/safe-fetch";
import { getSetting } from "@/server/quotes/service";
import { newId } from "@/server/util/ids";
import { normMobile } from "@/lib/crm";
import { addActivity, createLead, getLead } from "./leads";

/**
 * CRM WhatsApp: the business number (99974 04427) on Meta's WhatsApp Cloud API (Admin → API Keys & Services →
 * "WhatsApp for CRM Leads"). Staff send an approved template (intro with photo / video) from a lead, free text inside
 * the 24-hour window after the lead replies, and every reply / delivery tick lands on the lead's timeline.
 */

const GRAPH = "https://graph.facebook.com/v21.0";
const HOSTS = ["graph.facebook.com"];
export const WA_WINDOW_MS = 24 * 3600_000;

export type CrmWaTemplate = {
  name: string; language: string; category: string;
  header: "NONE" | "TEXT" | "IMAGE" | "VIDEO" | "DOCUMENT";
  headerText?: string; body: string; footer?: string; buttons: string[];
  /** Variables in the body, in order: named ("name") or positional ("1"). */
  vars: string[];
};
/** Admin-set photo / video link per template (header media). */
export type CrmWaMedia = Record<string, { url: string }>;
export const MEDIA_SETTING = "crm_wa_media";

export const crmWaConfig = () => activeService("crm_whatsapp");
export const e164 = (mobile: string) => { const m = normMobile(mobile); return /^[6-9]\d{9}$/.test(m) ? `91${m}` : m; };
export const windowOpen = (lastIn: Date | null | undefined, now = Date.now()) => !!lastIn && now - lastIn.getTime() < WA_WINDOW_MS;

type Cfg = Record<string, string>;
async function graph<T>(cfg: Cfg, path: string, init: { method?: string; body?: unknown } = {}): Promise<{ ok: boolean; status: number; j: T & { error?: { message?: string; error_user_msg?: string; code?: number } } }> {
  const r = await safeFetch(`${GRAPH}/${path}`, {
    method: init.method ?? "GET", allowedHosts: HOSTS, timeoutMs: 20_000,
    headers: { authorization: `Bearer ${cfg.accessToken}`, ...(init.body ? { "content-type": "application/json" } : {}) },
    ...(init.body ? { body: JSON.stringify(init.body) } : {}),
  });
  const j = (await r.json().catch(() => ({}))) as T & { error?: { message?: string; error_user_msg?: string; code?: number } };
  return { ok: r.ok && !j.error, status: r.status, j };
}
const metaError = (j: { error?: { message?: string; error_user_msg?: string } }, status: number) =>
  `WhatsApp: ${j.error?.error_user_msg ?? j.error?.message ?? `HTTP ${status}`}`.slice(0, 300);

type RawTemplate = { name: string; status: string; language: string; category: string; components?: Array<{ type: string; format?: string; text?: string; buttons?: Array<{ text?: string }> }> };

/** Variables of a template body: {{name}} or {{1}}, in order of first use. */
export const bodyVars = (body: string) => [...new Set([...body.matchAll(/\{\{\s*([a-z_][a-z0-9_]*|\d+)\s*\}\}/gi)].map((m) => m[1]))];

export function parseTemplate(t: RawTemplate): CrmWaTemplate {
  const c = (type: string) => t.components?.find((x) => x.type === type);
  const h = c("HEADER");
  const body = c("BODY")?.text ?? "";
  return {
    name: t.name, language: t.language, category: t.category,
    header: (h?.format as CrmWaTemplate["header"]) ?? "NONE", headerText: h?.format === "TEXT" ? h.text : undefined,
    body, footer: c("FOOTER")?.text, buttons: (c("BUTTONS")?.buttons ?? []).map((b) => b.text ?? "").filter(Boolean), vars: bodyVars(body),
  };
}

/** Approved templates of the WhatsApp Business Account (newest first). */
export async function approvedTemplates(cfg?: Cfg | null): Promise<{ ok: true; templates: CrmWaTemplate[] } | { ok: false; message: string }> {
  const c = cfg ?? (await crmWaConfig());
  if (!c) return { ok: false, message: "Connect WhatsApp for CRM in Admin → API Keys & Services first" };
  const r = await graph<{ data?: RawTemplate[] }>(c, `${encodeURIComponent(c.wabaId)}/message_templates?fields=name,status,language,category,components&limit=100`);
  if (!r.ok) return { ok: false, message: metaError(r.j, r.status) };
  return { ok: true, templates: (r.j.data ?? []).filter((t) => t.status === "APPROVED").map(parseTemplate) };
}

/** The value for each body variable: name / first_name / {{1}} → the lead's first name; city / company when asked for. */
export function fillVars(t: Pick<CrmWaTemplate, "vars">, lead: { name: string; city?: string | null; company?: string | null }) {
  const first = (lead.name || "").trim().split(/\s+/)[0] || "ji";
  return t.vars.map((v) => {
    const k = v.toLowerCase();
    if (k === "1" || /name/.test(k)) return first;
    if (/city/.test(k)) return lead.city || "aapke shehar";
    if (/company|business|brand/.test(k)) return lead.company || "aapka business";
    return first;
  });
}
export const renderBody = (body: string, vars: string[], values: string[]) => vars.reduce((s, v, i) => s.replace(new RegExp(`\\{\\{\\s*${v}\\s*\\}\\}`, "g"), values[i] ?? ""), body);

/** The Cloud API message for a template: header photo / video link + body variables. */
export function templatePayload(to: string, t: CrmWaTemplate, values: string[], mediaUrl?: string) {
  const components: Array<Record<string, unknown>> = [];
  if (t.header === "IMAGE" || t.header === "VIDEO" || t.header === "DOCUMENT") {
    const kind = t.header.toLowerCase();
    components.push({ type: "header", parameters: [{ type: kind, [kind]: { link: mediaUrl } }] });
  }
  if (t.vars.length) {
    const named = t.vars.some((v) => !/^\d+$/.test(v));
    components.push({ type: "body", parameters: t.vars.map((v, i) => ({ type: "text", text: values[i] ?? "", ...(named ? { parameter_name: v } : {}) })) });
  }
  return { messaging_product: "whatsapp", to, type: "template", template: { name: t.name, language: { code: t.language }, components } };
}

const MEDIA_RE = /^https:\/\/[^\s]+$/i;

async function recordOut(leadId: string, by: string, body: string, meta: Record<string, unknown>) {
  const db = await getDb();
  const lead = await getLead(leadId);
  await addActivity(leadId, "wa_out", body, by, meta);
  await db.update(schema.crmLeads).set({ lastWaOutAt: new Date(), waUnread: 0, ...(lead?.status === "new" ? { status: "contacted" } : {}), updatedAt: new Date() })
    .where(eq(schema.crmLeads.id, leadId));
}

export type SendResult = { ok: true; message: string } | { ok: false; message: string };

/** Send an approved template (first message / outside the 24-hour window). Photo / video header uses the saved link. */
export async function sendTemplate(leadId: string, templateName: string, by: string, mediaOverride?: string): Promise<SendResult> {
  const cfg = await crmWaConfig();
  if (!cfg) return { ok: false, message: "WhatsApp for CRM is not connected (Admin → API Keys & Services)" };
  const lead = await getLead(leadId);
  if (!lead?.mobile) return { ok: false, message: "This lead has no mobile number" };
  const list = await approvedTemplates(cfg);
  if (!list.ok) return list;
  const t = list.templates.find((x) => x.name === templateName);
  if (!t) return { ok: false, message: "That template is not approved on WhatsApp (yet)" };
  let mediaUrl: string | undefined;
  if (t.header === "IMAGE" || t.header === "VIDEO" || t.header === "DOCUMENT") {
    mediaUrl = mediaOverride?.trim() || (await getSetting<CrmWaMedia>(MEDIA_SETTING, {})).value[t.name]?.url;
    if (!mediaUrl || !MEDIA_RE.test(mediaUrl)) return { ok: false, message: `Add the ${t.header === "VIDEO" ? "video" : "photo"} link for “${t.name}” in CRM Leads → WhatsApp settings` };
  }
  const values = fillVars(t, lead);
  const r = await graph<{ messages?: Array<{ id: string }> }>(cfg, `${encodeURIComponent(cfg.phoneNumberId)}/messages`, { method: "POST", body: templatePayload(e164(lead.mobile), t, values, mediaUrl) });
  const id = r.j.messages?.[0]?.id;
  if (!r.ok || !id) return { ok: false, message: metaError(r.j, r.status) };
  const text = `${t.header === "IMAGE" ? "🖼️ " : t.header === "VIDEO" ? "🎬 " : ""}${renderBody(t.body, t.vars, values)}`;
  await recordOut(leadId, by, text, { waMsgId: id, status: "sent", template: t.name, mediaType: t.header === "NONE" || t.header === "TEXT" ? null : t.header.toLowerCase(), mediaUrl: mediaUrl ?? null });
  return { ok: true, message: `Sent “${t.name}” on WhatsApp` };
}

/** Free text (with an optional photo / video link) — only within 24 hours of the lead's last WhatsApp message. */
export async function sendSession(leadId: string, text: string, by: string, media?: { type: "image" | "video"; url: string }): Promise<SendResult> {
  const cfg = await crmWaConfig();
  if (!cfg) return { ok: false, message: "WhatsApp for CRM is not connected (Admin → API Keys & Services)" };
  const lead = await getLead(leadId);
  if (!lead?.mobile) return { ok: false, message: "This lead has no mobile number" };
  if (!windowOpen(lead.lastWaInAt)) return { ok: false, message: "WhatsApp allows free messages only within 24 hours of their last reply — send an approved template instead" };
  const body = text.trim();
  if (!body && !media) return { ok: false, message: "Type a message" };
  if (media && !MEDIA_RE.test(media.url)) return { ok: false, message: "The photo / video link must start with https://" };
  const payload = media
    ? { messaging_product: "whatsapp", to: e164(lead.mobile), type: media.type, [media.type]: { link: media.url, ...(body ? { caption: body.slice(0, 1024) } : {}) } }
    : { messaging_product: "whatsapp", to: e164(lead.mobile), type: "text", text: { body: body.slice(0, 4096), preview_url: true } };
  const r = await graph<{ messages?: Array<{ id: string }> }>(cfg, `${encodeURIComponent(cfg.phoneNumberId)}/messages`, { method: "POST", body: payload });
  const id = r.j.messages?.[0]?.id;
  if (!r.ok || !id) return { ok: false, message: metaError(r.j, r.status) };
  await recordOut(leadId, by, `${media ? (media.type === "image" ? "🖼️ " : "🎬 ") : ""}${body}`, { waMsgId: id, status: "sent", mediaType: media?.type ?? null, mediaUrl: media?.url ?? null });
  return { ok: true, message: "Sent on WhatsApp" };
}

// ---------- webhook (messages to / statuses from the CRM number) ----------
type WaMsg = { from?: string; id?: string; type?: string; text?: { body?: string }; image?: { caption?: string }; video?: { caption?: string };
  document?: { caption?: string; filename?: string }; audio?: unknown; sticker?: unknown; location?: { name?: string; address?: string };
  button?: { text?: string }; interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } }; reaction?: { emoji?: string };
  /** Set when the chat was opened from a Click-to-WhatsApp ad (or a Page post): which ad it came from. */
  referral?: { source_type?: string; source_id?: string; source_url?: string; headline?: string; body?: string; ctwa_clid?: string } };

/** "Meta ad (WhatsApp): <headline>" for a message that came from a Click-to-WhatsApp ad, else null. */
export function adReferral(m: WaMsg): { campaign: string; adName: string | null; note: string } | null {
  const r = m.referral;
  if (!r || (!r.source_id && !r.headline && !r.ctwa_clid)) return null;
  const what = r.source_type === "post" ? "Facebook / Instagram post" : "Meta ad";
  const title = (r.headline || r.body || "").trim().slice(0, 120);
  return {
    campaign: `${what} (WhatsApp)${title ? `: ${title}` : ""}`.slice(0, 200),
    adName: r.source_id ? `ad ${r.source_id}` : null,
    note: `📣 Came from ${what.toLowerCase()} → WhatsApp${title ? ` — “${title}”` : ""}${r.source_url ? ` (${r.source_url})` : ""}`.slice(0, 500),
  };
}
type WaStatus = { id?: string; status?: string; errors?: Array<{ title?: string; message?: string }> };
type WaValue = { metadata?: { phone_number_id?: string }; contacts?: Array<{ wa_id?: string; profile?: { name?: string } }>; messages?: WaMsg[]; statuses?: WaStatus[] };

/** What a message says, as text for the timeline. */
export function messageText(m: WaMsg): string {
  switch (m.type) {
    case "text": return m.text?.body ?? "";
    case "image": return `🖼️ Photo${m.image?.caption ? `: ${m.image.caption}` : ""}`;
    case "video": return `🎬 Video${m.video?.caption ? `: ${m.video.caption}` : ""}`;
    case "document": return `📄 ${m.document?.filename ?? "Document"}${m.document?.caption ? `: ${m.document.caption}` : ""}`;
    case "audio": return "🎤 Voice note";
    case "sticker": return "Sticker";
    case "location": return `📍 Location${m.location?.name ? `: ${m.location.name}` : ""}`;
    case "button": return m.button?.text ?? "";
    case "interactive": return m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? "";
    case "reaction": return `Reacted ${m.reaction?.emoji ?? ""}`.trim();
    default: return `(${m.type ?? "message"})`;
  }
}

const findActivity = async (waMsgId: string) => {
  const db = await getDb();
  const [a] = await db.select({ id: schema.crmActivities.id, meta: schema.crmActivities.meta }).from(schema.crmActivities).where(sql`${schema.crmActivities.meta}->>'waMsgId' = ${waMsgId}`).limit(1);
  return a ?? null;
};

/** The lead for a WhatsApp number: the most recently active one with that mobile, or a new WhatsApp lead. */
async function leadFor(mobile: string, profileName: string, ad: ReturnType<typeof adReferral> = null) {
  const db = await getDb();
  const m = normMobile(mobile);
  const [l] = await db.select().from(schema.crmLeads).where(eq(schema.crmLeads.mobile, m)).orderBy(desc(schema.crmLeads.updatedAt)).limit(1);
  if (l) {
    if (ad) await addActivity(l.id, "note", ad.note, null, { adReferral: true });
    return l.id;
  }
  const r = await createLead({ name: profileName || m, mobile: m, source: "whatsapp", campaign: ad?.campaign ?? "WhatsApp message", adName: ad?.adName ?? null }, null);
  if (ad) await addActivity(r.id, "note", ad.note, null, { adReferral: true });
  return r.id;
}

const STATUS_RANK: Record<string, number> = { sent: 1, delivered: 2, read: 3, failed: 4 };

/** Entries of a Meta webhook for the CRM number. Returns how many messages / statuses were stored. */
export async function handleCrmWebhook(body: Record<string, unknown>, phoneNumberId: string): Promise<{ messages: number; statuses: number }> {
  const db = await getDb();
  let messages = 0, statuses = 0;
  const entries = Array.isArray(body.entry) ? (body.entry as Array<{ changes?: Array<{ field?: string; value?: WaValue }> }>) : [];
  for (const e of entries) for (const ch of e.changes ?? []) {
    const v = ch.value ?? {};
    if (v.metadata?.phone_number_id !== phoneNumberId) continue;
    for (const m of v.messages ?? []) {
      if (!m.id || !m.from || (await findActivity(m.id))) continue;
      const profile = v.contacts?.find((c) => c.wa_id === m.from)?.profile?.name ?? "";
      const leadId = await leadFor(m.from, profile, adReferral(m));
      const text = messageText(m).slice(0, 2000);
      await db.insert(schema.crmActivities).values({ id: newId("cra"), leadId, kind: "wa_in", body: text, meta: { waMsgId: m.id, type: m.type ?? null }, byUserId: null });
      await db.update(schema.crmLeads).set({ lastWaInAt: new Date(), waUnread: sql`${schema.crmLeads.waUnread} + 1`, lastActivityAt: new Date(), lastNote: `💬 ${text}`.slice(0, 300), updatedAt: new Date() })
        .where(eq(schema.crmLeads.id, leadId));
      messages++;
    }
    for (const st of v.statuses ?? []) {
      if (!st.id || !st.status) continue;
      const a = await findActivity(st.id);
      if (!a) continue;
      const meta = (a.meta as Record<string, unknown>) ?? {};
      if ((STATUS_RANK[st.status] ?? 0) <= (STATUS_RANK[String(meta.status ?? "")] ?? 0)) continue;
      const err = st.errors?.[0];
      await db.update(schema.crmActivities).set({ meta: { ...meta, status: st.status, ...(err ? { error: err.message ?? err.title ?? "failed" } : {}) } })
        .where(and(eq(schema.crmActivities.id, a.id)));
      statuses++;
    }
  }
  return { messages, statuses };
}

/** Staff opened the lead: its WhatsApp replies are seen. */
export async function markSeen(leadId: string) {
  const db = await getDb();
  await db.update(schema.crmLeads).set({ waUnread: 0 }).where(and(eq(schema.crmLeads.id, leadId), sql`${schema.crmLeads.waUnread} > 0`));
}
