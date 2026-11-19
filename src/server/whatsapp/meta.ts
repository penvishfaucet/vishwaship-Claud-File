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
