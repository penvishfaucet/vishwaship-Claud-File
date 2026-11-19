import "server-only";
import { asc, desc, eq, ne } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { newId } from "@/server/util/ids";
import { AUTH_DEFAULTS, type AuthSettings, DEFAULT_SENDER, EMAIL_EVENTS, type EmailEventKey, eventDef, fillPlaceholders } from "@/lib/email-events";
import { deliver, senderVerification } from "./transport";

const appUrl = () => (process.env.APP_URL ?? "https://vishwaship.in").replace(/\/+$/, "");

// ------------------------------------------------------------------ settings

export async function getAuthSettings(): Promise<AuthSettings> {
  const db = await getDb();
  const [r] = await db.select().from(schema.pricingSettings).where(eq(schema.pricingSettings.key, "auth_settings"));
  return { ...AUTH_DEFAULTS, ...((r?.value as Partial<AuthSettings>) ?? {}) };
}
export async function saveAuthSettings(v: AuthSettings) {
  const db = await getDb();
  await db.insert(schema.pricingSettings).values({ key: "auth_settings", value: v }).onConflictDoUpdate({ target: schema.pricingSettings.key, set: { value: v, updatedAt: new Date() } });
}

/** The default sender always exists (contact@vishwaship.in at first). */
export async function senders() {
  const db = await getDb();
  let rows = await db.select().from(schema.emailSenders).orderBy(desc(schema.emailSenders.isDefault), asc(schema.emailSenders.email));
  if (!rows.length) {
    await db.insert(schema.emailSenders).values({ id: newId("snd"), email: DEFAULT_SENDER.email, displayName: DEFAULT_SENDER.displayName, isDefault: true, status: "pending" }).onConflictDoNothing();
    rows = await db.select().from(schema.emailSenders).orderBy(desc(schema.emailSenders.isDefault), asc(schema.emailSenders.email));
  }
  return rows;
}
export async function refreshSenderStatus(id: string) {
  const db = await getDb();
  const [s] = await db.select().from(schema.emailSenders).where(eq(schema.emailSenders.id, id));
  if (!s) return null;
  const v = await senderVerification(s.email);
  const status = s.status === "disabled" ? "disabled" : v.status;
  await db.update(schema.emailSenders).set({ status, statusDetail: v.detail, checkedAt: new Date() }).where(eq(schema.emailSenders.id, id));
  return { ...s, status, statusDetail: v.detail };
}

export async function template(event: EmailEventKey) {
  const db = await getDb();
  const [t] = await db.select().from(schema.emailTemplates).where(eq(schema.emailTemplates.event, event));
  const d = eventDef(event)!;
  return { subject: t?.subject ?? d.subject, body: t?.body ?? d.body, custom: !!t };
}
export async function rule(event: EmailEventKey) {
  const db = await getDb();
  const [r] = await db.select().from(schema.emailRules).where(eq(schema.emailRules.event, event));
  const d = eventDef(event)!;
  return { enabled: r?.enabled ?? d.defaults.enabled, senderId: r?.senderId ?? null, toClient: r?.toClient ?? d.defaults.toClient, toRecipient: r?.toRecipient ?? d.defaults.toRecipient };
}
export async function allRules() {
  return Promise.all(EMAIL_EVENTS.map(async (e) => ({ event: e.key, ...(await rule(e.key)) })));
}

/** Sender for an event: the rule's sender if usable, else the default sender. */
async function senderFor(event: EmailEventKey, override?: string | null) {
  const list = await senders();
  const want = override ?? (await rule(event)).senderId;
  const chosen = (want && list.find((s) => s.id === want && s.status !== "disabled")) || list.find((s) => s.isDefault) || list[0];
  return chosen;
}

// ------------------------------------------------------------------ render

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Branded email: Vishwaship logo, the message, an optional button. Placeholder values are HTML-escaped. */
export function renderEmail(event: EmailEventKey, tpl: { subject: string; body: string }, vars: Record<string, string>) {
  const d = eventDef(event)!;
  const subject = fillPlaceholders(tpl.subject, vars).replace(/[\r\n]+/g, " ").slice(0, 200);
  const text = fillPlaceholders(tpl.body, vars);
  const safe: Record<string, string> = Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, esc(v)]));
  const htmlBody = fillPlaceholders(esc(tpl.body).replace(/\{\{\s*([a-z_]+)\s*\}\}/g, "{{$1}}"), safe)
    .split(/\n{2,}/).map((p) => {
      const isCode = event === "signup_otp" && vars.otp && p.trim() === esc(vars.otp);
      return isCode ? `<p style="margin:18px 0;font-size:30px;letter-spacing:8px;font-weight:700;color:#051C46">${p.trim()}</p>` : `<p style="margin:0 0 14px">${p.replace(/\n/g, "<br>")}</p>`;
    }).join("");
  const button = d.button && vars.tracking_link ? `<p style="margin:22px 0"><a href="${esc(vars.tracking_link)}" style="background:#E5540C;color:#ffffff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px;display:inline-block">${esc(d.button)}</a></p>` : "";
  const html = `<!doctype html><html><body style="margin:0;background:#f4f6fa;font-family:Roboto,Arial,sans-serif;color:#051C46">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f6fa;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:16px;border:1px solid #dbe3ee">
<tr><td style="padding:22px 26px 8px"><img src="${appUrl()}/brand/vishwaship-logo-transparent.png" alt="vishwaship.com" height="56" style="height:56px;width:auto;display:block"></td></tr>
<tr><td style="padding:8px 26px 24px;font-size:15px;line-height:1.55">${htmlBody}${button}</td></tr>
<tr><td style="padding:14px 26px;border-top:1px solid #e9eef5;font-size:12px;color:#4a5a78">Vishwaship · <a href="${appUrl()}" style="color:#0057B8">vishwaship.in</a></td></tr>
</table></td></tr></table></body></html>`;
  return { subject, html, text };
}

const mask = (event: EmailEventKey, vars: Record<string, string>) => {
  const secret = new Set(eventDef(event)?.secret ?? []);
  return Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, secret.has(k) ? "••••••" : v]));
};

// ------------------------------------------------------------------ send

export type SendArgs = { event: EmailEventKey; to: string; toKind: "client" | "recipient" | "signup" | "test"; vars: Record<string, string>;
  orgId?: string | null; shipmentId?: string | null; dedupeKey?: string; senderId?: string | null; template?: { subject: string; body: string }; ignoreRule?: boolean };

/**
 * Send one email and record it in Email Logs. A dedupeKey already logged returns "duplicate" without sending.
 * Secrets (the OTP) are never stored: the log keeps masked values, so such emails are not retryable.
 */
export async function sendEmail(a: SendArgs): Promise<{ status: "sent" | "failed" | "skipped" | "duplicate"; logId?: string; error?: string }> {
  const db = await getDb();
  const to = a.to.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { status: "skipped", error: "No valid email address" };
  if (!a.ignoreRule && !(await rule(a.event)).enabled) return { status: "skipped", error: "Rule is off" };
  const sender = await senderFor(a.event, a.senderId);
  const tpl = a.template ?? (await template(a.event));
  const m = renderEmail(a.event, tpl, a.vars);
  const id = newId("eml");
  const secretEvent = !!eventDef(a.event)?.secret?.length;
  try {
    await db.insert(schema.emailLogs).values({ id, event: a.event, dedupeKey: a.dedupeKey ?? null, orgId: a.orgId ?? null, shipmentId: a.shipmentId ?? null, toEmail: to, toKind: a.toKind,
      senderEmail: sender.email, subject: secretEvent ? fillPlaceholders(tpl.subject, mask(a.event, a.vars)) : m.subject, vars: mask(a.event, a.vars), status: "queued", retryable: !secretEvent });
  } catch (e) {
    if (/unique|duplicate/i.test((e as Error).message) || (e as { code?: string; cause?: { code?: string } }).code === "23505" || (e as { cause?: { code?: string } }).cause?.code === "23505") return { status: "duplicate" };
    throw e;
  }
  return attempt(id, { from: `${sender.displayName} <${sender.email}>`, replyTo: sender.replyTo, to, subject: m.subject, html: m.html, text: m.text });
}

async function attempt(id: string, mail: Parameters<typeof deliver>[0]) {
  const db = await getDb();
  const r = await deliver(mail);
  const [cur] = await db.select({ attempts: schema.emailLogs.attempts }).from(schema.emailLogs).where(eq(schema.emailLogs.id, id));
  if (r.ok) {
    await db.update(schema.emailLogs).set({ status: "sent", providerId: r.providerId, error: null, sentAt: new Date(), attempts: (cur?.attempts ?? 0) + 1 }).where(eq(schema.emailLogs.id, id));
    return { status: "sent" as const, logId: id };
  }
  await db.update(schema.emailLogs).set({ status: "failed", error: r.error, attempts: (cur?.attempts ?? 0) + 1 }).where(eq(schema.emailLogs.id, id));
  return { status: "failed" as const, logId: id, error: r.error };
}

/** Admin "Retry" on a failed email: same recipient, current sender + template, stored (non-secret) values. */
export async function retryEmail(logId: string) {
  const db = await getDb();
  const [l] = await db.select().from(schema.emailLogs).where(eq(schema.emailLogs.id, logId));
  if (!l) return { ok: false as const, message: "Email not found" };
  if (l.status === "sent") return { ok: false as const, message: "Already sent" };
  if (!l.retryable) return { ok: false as const, message: "This email contained a one-time code and cannot be re-sent — the customer can tap Resend OTP" };
  const event = l.event as EmailEventKey;
  const sender = await senderFor(event);
  const m = renderEmail(event, await template(event), l.vars as Record<string, string>);
  await db.update(schema.emailLogs).set({ senderEmail: sender.email, subject: m.subject }).where(eq(schema.emailLogs.id, logId));
  const r = await attempt(logId, { from: `${sender.displayName} <${sender.email}>`, replyTo: sender.replyTo, to: l.toEmail, subject: m.subject, html: m.html, text: m.text });
  return r.status === "sent" ? { ok: true as const } : { ok: false as const, message: r.error ?? "Failed again" };
}

export async function emailLogs(limit = 200) {
  const db = await getDb();
  return db.select().from(schema.emailLogs).orderBy(desc(schema.emailLogs.createdAt)).limit(limit);
}

/** Which rules use each sender (rule senderId, or the default sender when a rule has none). */
export async function senderUsage() {
  const list = await senders();
  const rules = await allRules();
  const def = list.find((s) => s.isDefault)?.id;
  return Object.fromEntries(list.map((s) => [s.id, rules.filter((r) => (r.senderId ?? def) === s.id).map((r) => r.event)]));
}

/** Point every rule using `fromId` to `toId` (used before disabling / removing a sender). */
export async function moveRules(fromId: string, toId: string, by: string) {
  const db = await getDb();
  const list = await senders();
  const def = list.find((s) => s.isDefault)?.id;
  for (const r of await allRules()) if ((r.senderId ?? def) === fromId) {
    await db.insert(schema.emailRules).values({ event: r.event, enabled: r.enabled, senderId: toId, toClient: r.toClient, toRecipient: r.toRecipient, updatedBy: by })
      .onConflictDoUpdate({ target: schema.emailRules.event, set: { senderId: toId, updatedBy: by, updatedAt: new Date() } });
  }
  if (def === fromId) {
    await db.update(schema.emailSenders).set({ isDefault: false }).where(ne(schema.emailSenders.id, toId));
    await db.update(schema.emailSenders).set({ isDefault: true }).where(eq(schema.emailSenders.id, toId));
  }
}

