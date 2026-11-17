import { NextResponse } from "next/server";
import { providerContext } from "@/server/providers/registry";
import { clientIp, rateLimit } from "@/server/security/rate-limit";
import { safeEqual } from "@/server/security/crypto";
import { handleWatiWebhook, watiAccount } from "@/server/whatsapp/service";

/**
 * WATI webhook: https://<APP_URL>/api/webhooks/wati?token=<webhookToken>
 * WATI does not sign payloads, so the shared secret token (stored encrypted on the WATI account) is
 * compared in constant time. Unknown/bad tokens get 401 and are never processed.
 * Processing is idempotent (inbound_events dedupe), so WATI retries are safe.
 */
export async function POST(req: Request) {
  const rl = await rateLimit(`wati:${clientIp(req)}`, 600, 60);
  if (!rl.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  const acct = await watiAccount();
  if (!acct) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const expected = String((await providerContext(acct)).secrets.webhookToken ?? "");
  const got = new URL(req.url).searchParams.get("token") ?? req.headers.get("x-webhook-token") ?? "";
  if (!expected || !got || !safeEqual(expected, got)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const raw = await req.text();
  if (raw.length > 64_000) return NextResponse.json({ error: "too_large" }, { status: 413 });
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "bad_json" }, { status: 400 }); }
  const r = await handleWatiWebhook(body);
  return NextResponse.json({ ok: true, result: r.result });
}
