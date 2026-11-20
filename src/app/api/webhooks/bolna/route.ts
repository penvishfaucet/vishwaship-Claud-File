import { NextResponse } from "next/server";
import { providerContext } from "@/server/providers/registry";
import { clientIp, rateLimit } from "@/server/security/rate-limit";
import { safeEqual } from "@/server/security/crypto";
import { bolnaAccount, handleBolnaWebhook } from "@/server/ndr/ai-call";

/**
 * Bolna call results: https://<APP_URL>/api/webhooks/bolna?token=<webhookToken>
 * Authenticated with the secret token stored encrypted on the Bolna account (constant-time compare).
 * Idempotent per execution and status, so retries are safe.
 */
export async function POST(req: Request) {
  const rl = await rateLimit(`bolna:${clientIp(req)}`, 600, 60);
  if (!rl.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  const acct = await bolnaAccount();
  if (!acct) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const expected = String((await providerContext(acct)).secrets.webhookToken ?? "");
  const got = new URL(req.url).searchParams.get("token") ?? req.headers.get("x-webhook-token") ?? "";
  if (!expected || !got || !safeEqual(expected, got)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const raw = await req.text();
  if (raw.length > 512_000) return NextResponse.json({ error: "too_large" }, { status: 413 });
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "bad_json" }, { status: 400 }); }
  const r = await handleBolnaWebhook(body);
  return NextResponse.json({ ok: true, result: r.result });
}
