import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/server/audit";
import { apiStaff } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { apiError, parseJson } from "@/server/http";
import { newId } from "@/server/util/ids";
import { EMAIL_EVENTS, SAMPLE_VARS, eventDef, type EmailEventKey } from "@/lib/email-events";
import { moveRules, refreshSenderStatus, renderEmail, retryEmail, rule, saveAuthSettings, sendEmail, senderUsage, senders, template } from "@/server/email/service";

const ev = z.enum(EMAIL_EVENTS.map((e) => e.key) as [EmailEventKey, ...EmailEventKey[]]);
const email = z.string().trim().toLowerCase().email().max(160);
const Ops = z.discriminatedUnion("op", [
  z.object({ op: z.literal("auth_settings"), googleEnabled: z.boolean(), otpValidityMin: z.coerce.number().int().min(1).max(30), otpCooldownSec: z.coerce.number().int().min(15).max(600), otpMaxAttempts: z.coerce.number().int().min(1).max(10) }),
  z.object({ op: z.literal("sender_add"), email, displayName: z.string().trim().min(2).max(60), replyTo: email.optional().or(z.literal("")) }),
  z.object({ op: z.literal("sender_update"), id: z.string(), displayName: z.string().trim().min(2).max(60), replyTo: email.optional().or(z.literal("")) }),
  z.object({ op: z.literal("sender_check"), id: z.string() }),
  z.object({ op: z.literal("sender_default"), id: z.string() }),
  z.object({ op: z.literal("sender_disable"), id: z.string(), replacementId: z.string().optional() }),
  z.object({ op: z.literal("sender_enable"), id: z.string() }),
  z.object({ op: z.literal("rule_save"), event: ev, enabled: z.boolean(), senderId: z.string().nullable(), toClient: z.boolean(), toRecipient: z.boolean() }),
  z.object({ op: z.literal("template_save"), event: ev, subject: z.string().trim().min(3).max(200), body: z.string().trim().min(10).max(5000) }),
  z.object({ op: z.literal("template_reset"), event: ev }),
  z.object({ op: z.literal("template_preview"), event: ev, subject: z.string().max(200), body: z.string().max(5000) }),
  z.object({ op: z.literal("template_test"), event: ev, to: email, subject: z.string().max(200).optional(), body: z.string().max(5000).optional() }),
  z.object({ op: z.literal("log_retry"), id: z.string() }),
]);

/** Admin → Settings → Email & Sign-in. Read ops need notifications.read; changes need notifications.write; every change is audited. */
export async function POST(req: Request) {
  const p = await parseJson(req, Ops);
  if (!p.ok) return p.res;
  const b = p.data;
  const s = await apiStaff(b.op === "template_preview" ? "notifications.read" : "notifications.write");
  if (!s) return apiError(403, "forbidden", "You don't have permission to change email settings");
  const db = await getDb();
  const log = (details: Record<string, unknown>) => audit({ actorUserId: s.userId, actorKind: "staff", action: `email_settings.${b.op}`, details });
  const list = await senders();
  const find = (id: string) => list.find((x) => x.id === id);

  switch (b.op) {
    case "auth_settings": {
      const v = { googleEnabled: b.googleEnabled, otpValidityMin: b.otpValidityMin, otpCooldownSec: b.otpCooldownSec, otpMaxAttempts: b.otpMaxAttempts };
      await saveAuthSettings(v); await log(v);
      return NextResponse.json({ ok: true, message: "Saved. Applies to the next sign-up / sign-in." });
    }
    case "sender_add": {
      if (list.some((x) => x.email === b.email)) return apiError(409, "conflict", "This sender already exists");
      const id = newId("snd");
      await db.insert(schema.emailSenders).values({ id, email: b.email, displayName: b.displayName, replyTo: b.replyTo || null, status: "pending" });
      const r = await refreshSenderStatus(id); await log({ email: b.email, status: r?.status });
      return NextResponse.json({ ok: true, message: r?.status === "verified" ? "Sender added and verified." : `Sender added — ${r?.statusDetail ?? "verification pending"}. It can be used once verified.` });
    }
    case "sender_update": {
      if (!find(b.id)) return apiError(404, "not_found", "Sender not found");
      await db.update(schema.emailSenders).set({ displayName: b.displayName, replyTo: b.replyTo || null }).where(eq(schema.emailSenders.id, b.id));
      await log({ id: b.id, displayName: b.displayName, replyTo: b.replyTo || null });
      return NextResponse.json({ ok: true, message: "Saved" });
    }
    case "sender_check": {
      const r = await refreshSenderStatus(b.id); if (!r) return apiError(404, "not_found", "Sender not found");
      await log({ id: b.id, status: r.status });
      return NextResponse.json({ ok: true, message: `${r.email}: ${r.status} — ${r.statusDetail}` });
    }
    case "sender_default": {
      const x = find(b.id); if (!x) return apiError(404, "not_found", "Sender not found");
      if (x.status !== "verified") return apiError(409, "conflict", "Only a verified sender can be the default. Check verification first.");
      await db.update(schema.emailSenders).set({ isDefault: false }); await db.update(schema.emailSenders).set({ isDefault: true }).where(eq(schema.emailSenders.id, b.id));
      await log({ id: b.id, email: x.email });
      return NextResponse.json({ ok: true, message: `${x.email} is now the default sender` });
    }
    case "sender_disable": {
      const x = find(b.id); if (!x) return apiError(404, "not_found", "Sender not found");
      const used = (await senderUsage())[b.id] ?? [];
      if (used.length || x.isDefault) {
        const rep = b.replacementId ? find(b.replacementId) : undefined;
        if (!rep || rep.id === b.id || rep.status === "disabled") return apiError(409, "conflict", `Choose a replacement sender first — this one is used by: ${x.isDefault ? "default sender" : ""}${x.isDefault && used.length ? ", " : ""}${used.map((e) => eventDef(e)?.label ?? e).join(", ")}`);
        if (rep.status !== "verified" && !rep.isDefault) return apiError(409, "conflict", "The replacement sender must be verified");
        await moveRules(b.id, rep.id, s.userId);
      }
      await db.update(schema.emailSenders).set({ status: "disabled", isDefault: false }).where(eq(schema.emailSenders.id, b.id));
      await log({ id: b.id, email: x.email, replacementId: b.replacementId ?? null, movedRules: used });
      return NextResponse.json({ ok: true, message: `${x.email} disabled${used.length ? ` — ${used.length} rule(s) moved to the replacement` : ""}` });
    }
    case "sender_enable": {
      const x = find(b.id); if (!x) return apiError(404, "not_found", "Sender not found");
      await db.update(schema.emailSenders).set({ status: "pending" }).where(eq(schema.emailSenders.id, b.id));
      const r = await refreshSenderStatus(b.id); await log({ id: b.id, status: r?.status });
      return NextResponse.json({ ok: true, message: `${x.email}: ${r?.status}` });
    }
    case "rule_save": {
      if (b.senderId) { const x = find(b.senderId); if (!x || x.status !== "verified") return apiError(409, "conflict", "Choose a verified sender (or the default sender)"); }
      const enabled = b.event === "signup_otp" ? true : b.enabled; // email sign-up always verifies by OTP
      await db.insert(schema.emailRules).values({ event: b.event, enabled, senderId: b.senderId, toClient: b.toClient, toRecipient: b.toRecipient, updatedBy: s.userId })
        .onConflictDoUpdate({ target: schema.emailRules.event, set: { enabled, senderId: b.senderId, toClient: b.toClient, toRecipient: b.toRecipient, updatedBy: s.userId, updatedAt: new Date() } });
      await log({ event: b.event, enabled, senderId: b.senderId, toClient: b.toClient, toRecipient: b.toRecipient });
      return NextResponse.json({ ok: true, message: "Rule saved — applies to the next email" });
    }
    case "template_save": {
      await db.insert(schema.emailTemplates).values({ event: b.event, subject: b.subject, body: b.body, updatedBy: s.userId })
        .onConflictDoUpdate({ target: schema.emailTemplates.event, set: { subject: b.subject, body: b.body, updatedBy: s.userId, updatedAt: new Date() } });
      await log({ event: b.event, subject: b.subject });
      return NextResponse.json({ ok: true, message: "Template saved — applies to the next email" });
    }
    case "template_reset": {
      await db.delete(schema.emailTemplates).where(eq(schema.emailTemplates.event, b.event)); await log({ event: b.event });
      return NextResponse.json({ ok: true, message: "Template reset to the Vishwaship default" });
    }
    case "template_preview": {
      const m = renderEmail(b.event, { subject: b.subject, body: b.body }, SAMPLE_VARS);
      return NextResponse.json({ ok: true, subject: m.subject, html: m.html });
    }
    case "template_test": {
      const tpl = b.subject && b.body ? { subject: b.subject, body: b.body } : await template(b.event);
      const r = await sendEmail({ event: b.event, to: b.to, toKind: "test", vars: SAMPLE_VARS, template: tpl, ignoreRule: true, senderId: (await rule(b.event)).senderId });
      await log({ event: b.event, to: b.to, status: r.status });
      return r.status === "sent" ? NextResponse.json({ ok: true, message: `Test email sent to ${b.to} (sample values, not a real code)` }) : apiError(502, "provider_error", r.error ?? "Test email failed — see Email Logs");
    }
    case "log_retry": {
      const r = await retryEmail(b.id); await log({ id: b.id, ok: r.ok });
      return r.ok ? NextResponse.json({ ok: true, message: "Sent" }) : apiError(409, "conflict", r.message);
    }
  }
}
