import "server-only";
import type { ProviderContext } from "@/server/providers/types";
import type { WatiSendResult } from "./wati";

/**
 * Meta WhatsApp Cloud API (graph.facebook.com). Keys come from Admin → API Keys & Services → Meta WhatsApp.
 * Templates must be approved in WhatsApp Manager; named variables ({{buyer_name}} …) are filled by name.
 */
const GRAPH = "https://graph.facebook.com/v21.0";

/** Variables used in an approved template body, in order (named: {{buyer_name}}; numbered {{1}} are not supported). */
export const templateVars = (body: string) => [...new Set([...body.matchAll(/\{\{\s*([a-z_][a-z0-9_]*)\s*\}\}/gi)].map((m) => m[1]))];

export async function metaSendTemplate(ctx: ProviderContext, a: { toE164: string; templateName: string; language: string; body: string; params: Record<string, string> }): Promise<WatiSendResult> {
  const phoneId = String(ctx.secrets.phoneNumberId ?? ""), token = String(ctx.secrets.accessToken ?? "");
  if (!phoneId || !token) return { ok: false, error: "Meta WhatsApp phone number ID / token not configured", retryable: false };
  const names = templateVars(a.body);
  const components = names.length ? [{ type: "body", parameters: names.map((n) => ({ type: "text", parameter_name: n, text: a.params[n] ?? "" })) }] : [];
  let r: Response;
  try {
    r = await ctx.fetch(`${GRAPH}/${encodeURIComponent(phoneId)}/messages`, {
      method: "POST", timeoutMs: 15_000, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: a.toE164.replace(/^\+/, ""), type: "template", template: { name: a.templateName, language: { code: a.language || "en" }, components } }),
    });
  } catch (e) {
    return { ok: false, error: `Network error: ${(e as Error).message}`, retryable: true };
  }
  const j = (await r.json().catch(() => ({}))) as { messages?: Array<{ id: string }>; error?: { message?: string; code?: number } };
  if (r.ok && j.messages?.[0]?.id) return { ok: true, providerMessageId: j.messages[0].id };
  const msg = `Meta: ${j.error?.message ?? `HTTP ${r.status}`}`.slice(0, 200);
  return { ok: false, error: msg, retryable: r.status === 429 || r.status >= 500 || j.error?.code === 131016 };
}

export type InboundWa = { eventType: string; waId: string; msgId: string; replyText: string; replyContextId: string; deliveryStatus: string | null; isReply: boolean };

/** Flatten a Meta webhook (entry → changes → value.messages / value.statuses) into the shape the COD flow uses. */
export function parseMetaWebhook(body: Record<string, unknown>): InboundWa[] {
  const out: InboundWa[] = [];
  const entries = Array.isArray(body.entry) ? (body.entry as Array<Record<string, unknown>>) : [];
  for (const e of entries) for (const ch of (Array.isArray(e.changes) ? e.changes : []) as Array<{ value?: Record<string, unknown> }>) {
    const v = ch.value ?? {};
    for (const m of (Array.isArray(v.messages) ? v.messages : []) as Array<Record<string, unknown>>) {
      const button = m.button as { text?: string; payload?: string } | undefined;
      const inter = m.interactive as { button_reply?: { title?: string; id?: string } } | undefined;
      const text = (m.text as { body?: string } | undefined)?.body;
      out.push({ eventType: `message_${m.type ?? "unknown"}`, waId: String(m.from ?? "").replace(/\D/g, ""), msgId: String(m.id ?? ""),
        replyText: String(button?.text ?? button?.payload ?? inter?.button_reply?.title ?? text ?? "").trim(),
        replyContextId: String((m.context as { id?: string } | undefined)?.id ?? ""), deliveryStatus: null, isReply: true });
    }
    for (const s of (Array.isArray(v.statuses) ? v.statuses : []) as Array<Record<string, unknown>>) {
      const st = String(s.status ?? "");
      out.push({ eventType: `status_${st}`, waId: String(s.recipient_id ?? ""), msgId: String(s.id ?? ""), replyText: "", replyContextId: "",
        deliveryStatus: ["sent", "delivered", "read", "failed"].includes(st) ? st : null, isReply: false });
    }
  }
  return out;
}

/** Submit a template to Meta for approval (WhatsApp Manager → message templates). Named variables, quick-reply buttons. */
export async function metaCreateTemplate(ctx: ProviderContext, a: { name: string; language: string; body: string; examples: Record<string, string>; buttons: string[] }): Promise<{ ok: boolean; message: string; status?: string }> {
  const waba = String(ctx.secrets.wabaId || (ctx.config.values as Record<string, string> | undefined)?.wabaId || ""), token = String(ctx.secrets.accessToken ?? "");
  if (!waba || !token) return { ok: false, message: "Add the WhatsApp Business Account ID in API Keys & Services → Meta WhatsApp" };
  const names = templateVars(a.body);
  const components: Array<Record<string, unknown>> = [{ type: "BODY", text: a.body, ...(names.length ? { example: { body_text_named_params: names.map((n) => ({ param_name: n, example: a.examples[n] ?? n })) } } : {}) }];
  if (a.buttons.length) components.push({ type: "BUTTONS", buttons: a.buttons.map((t) => ({ type: "QUICK_REPLY", text: t })) });
  try {
    const r = await ctx.fetch(`${GRAPH}/${encodeURIComponent(waba)}/message_templates`, {
      method: "POST", timeoutMs: 20_000, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ name: a.name, language: a.language, category: "UTILITY", parameter_format: "NAMED", components }),
    });
    const j = (await r.json().catch(() => ({}))) as { id?: string; status?: string; error?: { message?: string; error_user_msg?: string } };
    if (r.ok && j.id) return { ok: true, message: `Submitted to Meta (${j.status ?? "PENDING"})`, status: j.status };
    return { ok: false, message: `Meta: ${j.error?.error_user_msg ?? j.error?.message ?? `HTTP ${r.status}`}`.slice(0, 250) };
  } catch (e) { return { ok: false, message: `Could not reach Meta: ${(e as Error).message}` }; }
}

export async function metaTemplateStatus(ctx: ProviderContext, name: string): Promise<{ ok: boolean; status?: string; message: string }> {
  const waba = String(ctx.secrets.wabaId || (ctx.config.values as Record<string, string> | undefined)?.wabaId || ""), token = String(ctx.secrets.accessToken ?? "");
  if (!waba || !token) return { ok: false, message: "Add the WhatsApp Business Account ID in API Keys & Services → Meta WhatsApp" };
  try {
    const r = await ctx.fetch(`${GRAPH}/${encodeURIComponent(waba)}/message_templates?name=${encodeURIComponent(name)}&fields=name,status,language`, { headers: { authorization: `Bearer ${token}` }, timeoutMs: 15_000 });
    const j = (await r.json().catch(() => ({}))) as { data?: Array<{ name: string; status: string }>; error?: { message?: string } };
    const t = j.data?.find((x) => x.name === name);
    if (!r.ok) return { ok: false, message: `Meta: ${j.error?.message ?? `HTTP ${r.status}`}` };
    return t ? { ok: true, status: t.status, message: `Meta status: ${t.status}` } : { ok: false, message: "Template not found on Meta yet" };
  } catch (e) { return { ok: false, message: `Could not reach Meta: ${(e as Error).message}` }; }
}
