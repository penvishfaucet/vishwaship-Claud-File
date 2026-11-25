"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { audit } from "@/server/audit";
import { requireStaff } from "@/server/auth/session";
import { CONTENT_KEYS, type ContentKey } from "@/server/content";
import { getDb, schema } from "@/server/db/client";
import { enqueue } from "@/server/jobs/runner";
import { MODULES, NOTIFICATION_EVENTS } from "@/lib/modules";
import { newId } from "@/server/util/ids";

/**
 * Admin server actions for module control. Every action re-checks the staff permission on the
 * server and writes an audit entry. Forms post one action each (hidden inputs, no submitter values).
 */
const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const MODULE_KEYS = MODULES.map((m) => m.key) as string[];
const EVENT_KEYS = NOTIFICATION_EVENTS.map((e) => e.key) as string[];
const LOCALES = ["en", "hi"];

// ---------- plans ----------
export async function savePlan(fd: FormData) {
  const s = await requireStaff("modules.manage");
  const id = str(fd, "id") || newId("plan");
  const name = str(fd, "name").slice(0, 60);
  if (!name) redirect("/admin/plans/?err=Plan+name+is+required");
  const v = {
    name, description: str(fd, "description").slice(0, 300) || null,
    pricePaise: Math.max(0, Math.round(Number(str(fd, "price")) * 100) || 0),
    billingPeriodDays: Math.max(1, Math.min(3650, Number(str(fd, "period")) || 30)),
    modules: fd.getAll("modules").map(String).filter((m) => MODULE_KEYS.includes(m)),
    events: fd.getAll("events").map(String).filter((e) => EVENT_KEYS.includes(e)),
    active: fd.get("active") === "on",
  };
  const db = await getDb();
  await db.insert(schema.plans).values({ id, ...v }).onConflictDoUpdate({ target: schema.plans.id, set: { ...v, updatedAt: new Date() } });
  await audit({ actorUserId: s.userId, actorKind: "staff", action: "plan.save", targetType: "plan", targetId: id, details: v });
  revalidatePath("/admin/plans/");
  redirect("/admin/plans/?ok=Plan+saved");
}

// Feature overrides and plan activation live in /api/admin/modules (client buttons; no server actions).

// ---------- content ----------
export async function saveContent(fd: FormData) {
  const s = await requireStaff("content.write");
  const key = str(fd, "key") as ContentKey;
  const locale = LOCALES.includes(str(fd, "locale")) ? str(fd, "locale") : "en";
  if (!(key in CONTENT_KEYS)) redirect("/admin/content/?err=Unknown+key");
  const draft = String(fd.get("draft") ?? "").slice(0, key.startsWith("public.policy.") ? 40_000 : 2000);
  const publish = str(fd, "publish") === "1";
  const db = await getDb();
  const now = new Date();
  const set = publish ? { draft, published: draft, updatedBy: s.userId, updatedAt: now, publishedBy: s.userId, publishedAt: now } : { draft, updatedBy: s.userId, updatedAt: now };
  await db.insert(schema.contentBlocks).values({ key, locale, ...set }).onConflictDoUpdate({ target: [schema.contentBlocks.key, schema.contentBlocks.locale], set });
  await audit({ actorUserId: s.userId, actorKind: "staff", action: publish ? "content.publish" : "content.draft", targetType: "content", targetId: `${key}:${locale}` });
  revalidatePath("/", "layout");
  redirect(`/admin/content/?locale=${locale}&group=${key.startsWith("nav.") ? "nav" : key.startsWith("public.policy.") ? "policies" : "pages"}&ok=${publish ? "Published" : "Draft+saved"}#${key}`);
}

export async function revertContent(fd: FormData) {
  const s = await requireStaff("content.write");
  const key = str(fd, "key");
  const locale = LOCALES.includes(str(fd, "locale")) ? str(fd, "locale") : "en";
  const db = await getDb();
  await db.delete(schema.contentBlocks).where(and(eq(schema.contentBlocks.key, key), eq(schema.contentBlocks.locale, locale)));
  await audit({ actorUserId: s.userId, actorKind: "staff", action: "content.revert", targetType: "content", targetId: `${key}:${locale}` });
  revalidatePath("/", "layout");
  redirect(`/admin/content/?locale=${locale}&group=${key.startsWith("nav.") ? "nav" : key.startsWith("public.policy.") ? "policies" : "pages"}&ok=Reverted+to+default`);
}

// ---------- branded tracking pages ----------
export async function setTrackingPageDisabled(fd: FormData) {
  const s = await requireStaff("modules.manage");
  const orgId = str(fd, "orgId");
  const disabled = str(fd, "disabled") === "1";
  const db = await getDb();
  await db.update(schema.trackingPages).set({ disabledByAdmin: disabled, updatedAt: new Date() }).where(eq(schema.trackingPages.orgId, orgId));
  await audit({ actorUserId: s.userId, actorKind: "staff", orgId, action: disabled ? "tracking_page.disable" : "tracking_page.enable" });
  redirect("/admin/tracking-pages/?ok=Updated");
}

// ---------- WhatsApp ----------
export async function saveTemplateMapping(fd: FormData) {
  const s = await requireStaff("notifications.write");
  const event = str(fd, "event");
  if (!["out_for_delivery", "cod_confirmation"].includes(event)) redirect("/admin/whatsapp/?err=Unknown+event");
  const providerTemplateName = str(fd, "templateName").replace(/[^a-z0-9_]/gi, "").slice(0, 80) || null;
  const approvalState = ["draft", "submitted", "approved", "rejected"].includes(str(fd, "approval")) ? str(fd, "approval") : "draft";
  const language = ["en", "hi"].includes(str(fd, "language")) ? str(fd, "language") : "en";
  const body = String(fd.get("body") ?? "").slice(0, 1024);
  const db = await getDb();
  const [row] = await db.select().from(schema.notificationTemplates).where(and(eq(schema.notificationTemplates.channel, "whatsapp"), eq(schema.notificationTemplates.event, event)));
  if (row) await db.update(schema.notificationTemplates).set({ providerTemplateName, approvalState, language, body, updatedAt: new Date() }).where(eq(schema.notificationTemplates.id, row.id));
  else await db.insert(schema.notificationTemplates).values({ id: newId("tpl"), channel: "whatsapp", event, providerTemplateName, approvalState, language, body });
  await audit({ actorUserId: s.userId, actorKind: "staff", action: "whatsapp.template_mapping", targetType: "template", targetId: event, details: { providerTemplateName, approvalState, language } });
  redirect("/admin/whatsapp/?ok=Template+saved");
}

/** COD confirmation: put the ready-made template text (English or Hindi) into the mapping, as a draft. */
export async function fillDefaultCodTemplate(fd: FormData) {
  const s = await requireStaff("notifications.write");
  const { COD_TEMPLATE } = await import("@/lib/cod-template");
  const language = str(fd, "language") === "hi" ? "hi" : "en";
  const name = (str(fd, "templateName").replace(/[^a-z0-9_]/gi, "").toLowerCase() || `vs_cod_confirm_${language}`).slice(0, 60);
  const db = await getDb();
  const [row] = await db.select().from(schema.notificationTemplates).where(and(eq(schema.notificationTemplates.channel, "whatsapp"), eq(schema.notificationTemplates.event, "cod_confirmation")));
  const v = { providerTemplateName: name, language, body: COD_TEMPLATE[language], approvalState: "draft", updatedAt: new Date() };
  if (row) await db.update(schema.notificationTemplates).set(v).where(eq(schema.notificationTemplates.id, row.id));
  else await db.insert(schema.notificationTemplates).values({ id: newId("tpl"), channel: "whatsapp", event: "cod_confirmation", ...v });
  await audit({ actorUserId: s.userId, actorKind: "staff", action: "whatsapp.template_default", targetType: "template", targetId: "cod_confirmation", details: { language, name } });
  redirect("/admin/whatsapp/?ok=Ready-made+COD+template+filled+in+(draft)");
}

/** Meta Cloud API: create the COD template on Meta, or read its approval status (APPROVED → mapping becomes Approved). */
export async function metaCodTemplate(fd: FormData) {
  const s = await requireStaff("notifications.write");
  const { metaCreateTemplate, metaTemplateStatus } = await import("@/server/whatsapp/meta");
  const { COD_BUTTONS, COD_SAMPLE } = await import("@/lib/cod-template");
  const { whatsappAccount } = await import("@/server/whatsapp/service");
  const { providerContext } = await import("@/server/providers/registry");
  const acct = await whatsappAccount();
  if (!acct || acct.adapter !== "meta_whatsapp") redirect("/admin/whatsapp/?err=Turn+on+Meta+WhatsApp+Cloud+API+first");
  const db = await getDb();
  const [row] = await db.select().from(schema.notificationTemplates).where(and(eq(schema.notificationTemplates.channel, "whatsapp"), eq(schema.notificationTemplates.event, "cod_confirmation")));
  if (!row?.providerTemplateName || !row.body) redirect("/admin/whatsapp/?err=Fill+in+the+COD+template+first");
  const ctx = await providerContext(acct!);
  const check = str(fd, "op") === "check";
  const r = check ? await metaTemplateStatus(ctx, row!.providerTemplateName!) : await metaCreateTemplate(ctx, { name: row!.providerTemplateName!, language: row!.language, body: row!.body, examples: COD_SAMPLE, buttons: [COD_BUTTONS.confirm, COD_BUTTONS.cancel] });
  const st = (r as { status?: string }).status?.toUpperCase();
  const approvalState = st === "APPROVED" ? "approved" : st === "REJECTED" ? "rejected" : r.ok ? "submitted" : row!.approvalState;
  await db.update(schema.notificationTemplates).set({ approvalState, updatedAt: new Date() }).where(eq(schema.notificationTemplates.id, row!.id));
  await audit({ actorUserId: s.userId, actorKind: "staff", action: check ? "whatsapp.template_status" : "whatsapp.template_submit", targetType: "template", targetId: "cod_confirmation", details: { ok: r.ok, status: st ?? null } });
  redirect(`/admin/whatsapp/?${r.ok ? "ok" : "err"}=${encodeURIComponent(r.message)}`);
}

export async function saveCodSettings(fd: FormData) {
  const s = await requireStaff("notifications.write");
  const value = {
    reminderMinutes: Math.max(15, Math.min(1440, Number(fd.get("reminder")) || 120)),
    expiryMinutes: Math.max(30, Math.min(4320, Number(fd.get("expiry")) || 1440)),
    noReply: ["release", "hold_for_review", "cancel"].includes(str(fd, "noReply")) ? str(fd, "noReply") : "release",
    credits: Math.max(0, Math.min(10, Number(fd.get("credits")) || 0)),
  };
  const db = await getDb();
  await db.insert(schema.pricingSettings).values({ key: "cod_confirmation", value }).onConflictDoUpdate({ target: schema.pricingSettings.key, set: { value, updatedAt: new Date() } });
  await audit({ actorUserId: s.userId, actorKind: "staff", action: "notifications.cod_settings", details: value });
  redirect("/admin/whatsapp/?ok=COD+settings+saved");
}

/** Retry a failed WhatsApp message: re-arm a fresh message row via the original job type. */
export async function retryWhatsapp(fd: FormData) {
  const s = await requireStaff("notifications.write");
  const id = str(fd, "id");
  const db = await getDb();
  const [m] = await db.select().from(schema.whatsappMessages).where(eq(schema.whatsappMessages.id, id));
  if (!m || m.status !== "failed") redirect("/admin/whatsapp/?err=Only+failed+messages+can+be+retried");
  // a new dedupe key (suffix) so the retry is a distinct, single send; the original row stays as history
  const n = Date.now().toString(36);
  if (m.event === "cod_confirmation" && m.orderId) {
    const [c] = await db.update(schema.codConfirmations).set({ status: "pending", sentAt: null }).where(and(eq(schema.codConfirmations.orderId, m.orderId), eq(schema.codConfirmations.status, "send_failed"))).returning();
    if (!c) redirect("/admin/whatsapp/?err=That+confirmation+is+no+longer+waiting+to+be+sent");
    await db.update(schema.whatsappMessages).set({ dedupeKey: `${m.dedupeKey}:retired:${n}`, updatedAt: new Date() }).where(eq(schema.whatsappMessages.id, m.id));
    await enqueue("cod.send", { orderId: m.orderId }, { dedupeKey: `cod.send:${m.orderId}:retry:${n}` });
  } else if (m.event === "out_for_delivery" && m.shipmentId) {
    await db.update(schema.whatsappMessages).set({ dedupeKey: `${m.dedupeKey}:retired:${n}`, updatedAt: new Date() }).where(eq(schema.whatsappMessages.id, m.id));
    const day = m.dedupeKey.split(":")[3] ?? new Date().toISOString().slice(0, 10);
    await enqueue("whatsapp.send", { event: "out_for_delivery", shipmentId: m.shipmentId, orderId: m.orderId, orgId: m.orgId, day }, { dedupeKey: `wa:ofd:${m.shipmentId}:${day}:retry:${n}` });
  }
  await audit({ actorUserId: s.userId, actorKind: "staff", orgId: m.orgId, action: "whatsapp.retry", targetType: "whatsapp_message", targetId: m.id });
  redirect("/admin/whatsapp/?ok=Retry+queued");
}
