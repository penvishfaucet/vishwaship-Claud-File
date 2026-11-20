import { NextResponse } from "next/server";
import { providerContext } from "@/server/providers/registry";
import { clientIp, rateLimit } from "@/server/security/rate-limit";
import { safeEqual } from "@/server/security/crypto";
import { aisensyAccount, handleAisensyWebhook } from "@/server/whatsapp/service";

/**
 * AiSensy webhook: https://<APP_URL>/api/webhooks/aisensy?token=<webhookToken>
 * Authenticated with the shared secret token stored encrypted on the AiSensy account (constant-time compare).
 * Processing is idempotent (inbound_events dedupe), so retries are safe.
 */
export async function POST(req: Request) {
  const rl = await rateLimit(`aisensy:${clientIp(req)}`, 600, 60);
  if (!rl.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  const acct = await aisensyAccount();
  if (!acct) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const expected = String((await providerContext(acct)).secrets.webhookToken ?? "");
  const got = new URL(req.url).searchParams.get("token") ?? req.headers.get("x-webhook-token") ?? "";
  if (!expected || !got || !safeEqual(expected, got)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const raw = await req.text();
  if (raw.length > 64_000) return NextResponse.json({ error: "too_large" }, { status: 413 });
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "bad_json" }, { status: 400 }); }
  const r = await handleAisensyWebhook(body);
  return NextResponse.json({ ok: true, result: r.result });
}
