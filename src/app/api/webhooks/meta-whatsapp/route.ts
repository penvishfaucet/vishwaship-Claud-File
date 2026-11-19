import { NextResponse } from "next/server";
import { activeService } from "@/server/integrations/services";
import { clientIp, rateLimit } from "@/server/security/rate-limit";
import { hmacSha256Hex, safeEqual } from "@/server/security/crypto";
import { handleMetaWebhook } from "@/server/whatsapp/service";

/**
 * Meta WhatsApp Cloud API webhook: <site>/api/webhooks/meta-whatsapp
 * GET  — Meta's one-time verification (hub.verify_token must equal the verify token saved in Admin).
 * POST — events, signed with the app secret (X-Hub-Signature-256); unsigned or wrongly signed requests are rejected.
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const v = await activeService("meta_whatsapp");
  const token = u.searchParams.get("hub.verify_token") ?? "";
  if (u.searchParams.get("hub.mode") === "subscribe" && v?.verifyToken && token && safeEqual(v.verifyToken, token)) {
    return new NextResponse(u.searchParams.get("hub.challenge") ?? "", { status: 200, headers: { "content-type": "text/plain" } });
  }
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}

export async function POST(req: Request) {
  const rl = await rateLimit(`metawa:${clientIp(req)}`, 1200, 60);
  if (!rl.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  const v = await activeService("meta_whatsapp");
  if (!v?.appSecret) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const raw = await req.text();
  if (raw.length > 256_000) return NextResponse.json({ error: "too_large" }, { status: 413 });
  const sig = (req.headers.get("x-hub-signature-256") ?? "").replace(/^sha256=/, "");
  if (!sig || !safeEqual(sig, hmacSha256Hex(v.appSecret, raw))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "bad_json" }, { status: 400 }); }
  const r = await handleMetaWebhook(body);
  return NextResponse.json({ ok: true, result: r.result });
}
