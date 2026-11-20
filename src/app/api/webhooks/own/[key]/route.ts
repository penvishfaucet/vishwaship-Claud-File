import { NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/server/security/rate-limit";
import { ownByWebhookKey } from "@/server/own-providers";

/**
 * A client's own WATI / AiSensy / Bolna sends replies and call results here:
 * https://<APP_URL>/api/webhooks/own/<secret key shown on the client's page>. The long random key is the secret.
 */
export async function POST(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const rl = await rateLimit(`own-wh:${clientIp(req)}`, 600, 60);
  if (!rl.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  const { key } = await params;
  const who = await ownByWebhookKey(key);
  if (!who) return NextResponse.json({ error: "unknown" }, { status: 404 });
  const raw = await req.text();
  if (raw.length > 512_000) return NextResponse.json({ error: "too_large" }, { status: 413 });
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "bad_json" }, { status: 400 }); }
  if (who.kind === "calling") {
    const { handleBolnaWebhook } = await import("@/server/ndr/ai-call");
    return NextResponse.json({ ok: true, result: (await handleBolnaWebhook(body)).result });
  }
  const { handleOwnWhatsappWebhook } = await import("@/server/whatsapp/service");
  return NextResponse.json({ ok: true, result: (await handleOwnWhatsappWebhook(who.adapter as "wati" | "aisensy", body)).result });
}
