import "server-only";
import type { ProviderContext } from "@/server/providers/types";

/**
 * WATI (WhatsApp Business API) client — https://docs.wati.io/reference/introduction
 * Account secrets (Admin → Integrations → WATI): apiEndpoint (e.g. https://live-mt-server.wati.io/<tenant-id>),
 * accessToken (Bearer), webhookToken (shared secret we put in the webhook URL).
 * Request/response field names follow WATI's v1 API; verify them against the live account before go-live
 * (WATI does not sign webhooks, so we authenticate them with the secret token and strict matching).
 */
export interface WatiSendResult { ok: boolean; providerMessageId?: string; error?: string; retryable?: boolean }

export async function watiSendTemplate(ctx: ProviderContext, a: { toE164: string; templateName: string; broadcastName: string; params: Record<string, string> }): Promise<WatiSendResult> {
  const base = String(ctx.secrets.apiEndpoint ?? "").replace(/\/$/, "");
  if (!base || !ctx.secrets.accessToken) return { ok: false, error: "WATI endpoint/token not configured", retryable: false };
  const number = a.toE164.replace(/^\+/, "");
  let r: Response;
  try {
    r = await ctx.fetch(`${base}/api/v1/sendTemplateMessage?whatsappNumber=${encodeURIComponent(number)}`, {
      method: "POST", timeoutMs: 15_000,
      headers: { authorization: `Bearer ${ctx.secrets.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ template_name: a.templateName, broadcast_name: a.broadcastName, parameters: Object.entries(a.params).map(([name, value]) => ({ name, value })) }),
    });
  } catch (e) {
    return { ok: false, error: `Network error: ${(e as Error).message}`, retryable: true };
  }
  const text = await r.text();
  let j: Record<string, unknown> = {};
  try { j = JSON.parse(text); } catch { /* non-JSON */ }
  if (r.status === 401 || r.status === 403) return { ok: false, error: "WATI rejected the access token", retryable: false };
  if (r.status === 429 || r.status >= 500) return { ok: false, error: `WATI HTTP ${r.status}`, retryable: true };
  if (!r.ok || j.result === false) return { ok: false, error: String(j.info ?? j.message ?? `WATI HTTP ${r.status}`).slice(0, 200), retryable: false };
  const id = (j.messageId ?? (j.message as Record<string, unknown> | undefined)?.whatsappMessageId ?? j.localMessageId ?? j.id) as string | undefined;
  return { ok: true, providerMessageId: id ? String(id) : undefined };
}

export async function watiHealth(ctx: ProviderContext): Promise<{ ok: boolean; message: string }> {
  const base = String(ctx.secrets.apiEndpoint ?? "").replace(/\/$/, "");
  if (!base || !ctx.secrets.accessToken) return { ok: false, message: "Enter apiEndpoint and accessToken" };
  try {
    const r = await ctx.fetch(`${base}/api/v1/getMessageTemplates?pageSize=1`, { headers: { authorization: `Bearer ${ctx.secrets.accessToken}` }, timeoutMs: 10_000 });
    return r.ok ? { ok: true, message: "Connected to WATI (templates readable)" } : { ok: false, message: `WATI HTTP ${r.status}` };
  } catch (e) { return { ok: false, message: (e as Error).message }; }
}

/** Normalise a WATI webhook payload into what we need. Tolerant of field-name variants. */
export function parseWatiWebhook(body: Record<string, unknown>) {
  const eventType = String(body.eventType ?? body.event ?? body.type ?? "");
  const waId = String(body.waId ?? body.whatsappNumber ?? body.from ?? "").replace(/\D/g, "");
  const msgId = String(body.whatsappMessageId ?? body.id ?? body.localMessageId ?? "");
  const btn = (body.buttonReply ?? body.interactiveButtonReply ?? null) as { text?: string; payload?: string; title?: string } | null;
  const replyText = String(btn?.text ?? btn?.title ?? btn?.payload ?? body.text ?? "").trim();
  const replyContextId = String((body.context as Record<string, unknown> | undefined)?.id ?? body.replyContextId ?? "");
  const statusMap: Record<string, string> = { sentMessageDELIVERED: "delivered", sentMessageREAD: "read", sentMessageSENT: "sent", templateMessageFailed: "failed", sentMessageFAILED: "failed" };
  return { eventType, waId, msgId, replyText, replyContextId, deliveryStatus: statusMap[eventType] ?? null, isReply: /^message/i.test(eventType) || !!btn };
}

/** Map the buyer's button text to a decision. */
export function decisionFromReply(text: string): "confirm" | "cancel" | null {
  const t = text.trim().toLowerCase();
  if (/^(confirm|confirm order|yes|हाँ|हां)$/.test(t)) return "confirm";
  if (/^(cancel|cancel order|no|नहीं)$/.test(t)) return "cancel";
  return null;
}
