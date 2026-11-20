import "server-only";
import type { ProviderContext } from "@/server/providers/types";
import type { InboundWa } from "./meta";
import { templateVars } from "./meta";
import type { WatiSendResult } from "./wati";

/**
 * AiSensy (WhatsApp Business API) — Campaign API v2: POST https://backend.aisensy.com/campaign/t1/api/v2
 * Admin → API Keys & Services → AiSensy: apiKey (AiSensy → Manage → API key) and a webhook token we choose.
 * In AiSensy every approved template is sent through an "API campaign"; the campaign name is what
 * WhatsApp Ops → Template mapping stores as the template name.
 * AiSensy templates use numbered variables ({{1}}, {{2}} …): we fill them in the order below
 * (or, when the mapped template body uses named variables, in the order they appear in that body).
 */
const ENDPOINT = "https://backend.aisensy.com/campaign/t1/api/v2";

/** Fill order for numbered AiSensy template variables, per event. Shown in Admin so templates are written to match. */
export const AISENSY_PARAM_ORDER: Record<string, string[]> = {
  cod_confirmation: ["buyer_name", "store_name", "order_id", "cod_amount", "delivery_address", "expected_delivery", "store_note", "support_phone"],
  out_for_delivery: ["buyer_name", "order_id", "carrier", "awb", "tracking_link"],
};

export async function aisensySendTemplate(ctx: ProviderContext, a: { toE164: string; campaignName: string; event: string; body: string; params: Record<string, string> }): Promise<WatiSendResult> {
  const apiKey = String(ctx.secrets.apiKey ?? "");
  if (!apiKey) return { ok: false, error: "AiSensy API key not configured", retryable: false };
  const named = templateVars(a.body);
  const order = named.length ? named : AISENSY_PARAM_ORDER[a.event] ?? [];
  let r: Response;
  try {
    r = await ctx.fetch(ENDPOINT, {
      method: "POST", timeoutMs: 15_000, headers: { "content-type": "application/json" },
      body: JSON.stringify({
        apiKey, campaignName: a.campaignName, destination: a.toE164.replace(/^\+/, ""), userName: a.params.buyer_name || "Customer",
        templateParams: order.map((k) => a.params[k] ?? ""), source: "vishwaship", media: {}, buttons: [], carouselCards: [], location: {},
        attributes: { order_id: a.params.order_id ?? "" }, paramsFallbackValue: { FirstName: a.params.buyer_name || "Customer" },
      }),
    });
  } catch (e) {
    return { ok: false, error: `Network error: ${(e as Error).message}`, retryable: true };
  }
  const text = await r.text();
  let j: Record<string, unknown> = {};
  try { j = JSON.parse(text); } catch { /* non-JSON */ }
  const msg = String(j.message ?? j.errorMessage ?? j.error ?? (text.slice(0, 120) || `HTTP ${r.status}`));
  if (r.status === 401 || r.status === 403 || /api ?key|unauthori[sz]ed|forbidden/i.test(msg) && !r.ok) return { ok: false, error: "AiSensy rejected the API key", retryable: false };
  if (r.status === 429 || r.status >= 500) return { ok: false, error: `AiSensy HTTP ${r.status}`, retryable: true };
  const success = r.ok && j.success !== false && j.success !== "false";
  if (!success) return { ok: false, error: `AiSensy: ${msg}`.slice(0, 200), retryable: false };
  const id = (j.submitted_message_id ?? j.messageId ?? j.message_id ?? (j.data as Record<string, unknown> | undefined)?.id ?? j.id) as string | undefined;
  return { ok: true, providerMessageId: id ? String(id) : undefined };
}

/** Find the first string at any of these keys, searching nested objects (AiSensy webhook bodies vary by topic). */
function deep(o: unknown, keys: string[], depth = 0): string {
  if (!o || typeof o !== "object" || depth > 5) return "";
  const r = o as Record<string, unknown>;
  for (const k of keys) { const v = r[k]; if (typeof v === "string" && v.trim()) return v.trim(); if (typeof v === "number") return String(v); }
  for (const v of Object.values(r)) { if (v && typeof v === "object") { const x = deep(v, keys, depth + 1); if (x) return x; } }
  return "";
}

/**
 * AiSensy webhook (Manage → Webhooks): topics such as message.sender.user (a buyer's message or button tap)
 * and message.status.updated (sent / delivered / read / failed). Read defensively.
 */
export function parseAisensyWebhook(body: Record<string, unknown>): InboundWa {
  const topic = String(body.topic ?? body.event ?? body.type ?? "");
  const data = (body.data ?? body) as Record<string, unknown>;
  const message = (data.message ?? data) as Record<string, unknown>;
  const waId = deep(message, ["phone_number", "phoneNumber", "from", "waId", "wa_id", "userNumber", "destination"]).replace(/\D/g, "") || deep(data, ["phone_number", "phoneNumber", "from", "waId"]).replace(/\D/g, "");
  const msgId = deep(message, ["messageId", "message_id", "whatsappMessageId", "wamid", "id"]);
  const content = (message.message_content ?? message.messageContent ?? message.content ?? {}) as Record<string, unknown>;
  const replyText = (deep(content, ["text", "title", "payload", "body"]) || deep(message, ["buttonText", "button_text", "text", "body"])).slice(0, 80);
  const replyContextId = deep(message.context ?? message.reply_to ?? message.replyTo ?? {}, ["id", "messageId", "message_id", "wamid"]);
  const rawStatus = deep(message, ["status", "delivery_status", "deliveryStatus"]).toLowerCase();
  const isStatus = /status/i.test(topic) || (!replyText && !!rawStatus);
  const deliveryStatus = isStatus ? (["sent", "delivered", "read", "failed"].find((s) => rawStatus.includes(s)) ?? null) : null;
  const sender = deep(message, ["sender", "sent_by", "direction"]).toLowerCase();
  const fromBuyer = /sender\.user|incoming|received|inbound/i.test(topic) || /user|customer|incoming|inbound/.test(sender);
  return { eventType: topic || (isStatus ? "status" : "message"), waId, msgId, replyText, replyContextId, deliveryStatus, isReply: !isStatus && fromBuyer && !!replyText };
}
