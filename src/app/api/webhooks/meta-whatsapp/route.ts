import { NextResponse } from "next/server";
import { activeService } from "@/server/integrations/services";
import { clientIp, rateLimit } from "@/server/security/rate-limit";
import { hmacSha256Hex, safeEqual } from "@/server/security/crypto";
import { handleMetaWebhook } from "@/server/whatsapp/service";
import { handleCrmWebhook } from "@/server/crm/whatsapp";

/**
 * Meta WhatsApp Cloud API webhook: <site>/api/webhooks/meta-whatsapp — shared by
 *  - "Meta WhatsApp Cloud API" (COD confirmations / shipment messages) and
 *  - "WhatsApp for CRM Leads" (the business number: replies land on the lead).
 * GET  — Meta's one-time verification (hub.verify_token must equal a verify token saved in Admin).
 * POST — events, signed with the app secret (X-Hub-Signature-256); unsigned or wrongly signed requests are rejected.
 *        Events for the CRM number go to CRM Leads; everything else to the COD / shipment flow.
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const [cod, crm] = await Promise.all([activeService("meta_whatsapp"), activeService("crm_whatsapp")]);
  const token = u.searchParams.get("hub.verify_token") ?? "";
  const ok = token && [cod?.verifyToken, crm?.verifyToken].some((t) => t && safeEqual(t, token));
  if (u.searchParams.get("hub.mode") === "subscribe" && ok) {
    return new NextResponse(u.searchParams.get("hub.challenge") ?? "", { status: 200, headers: { "content-type": "text/plain" } });
  }
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}

type Entry = { changes?: Array<{ value?: { metadata?: { phone_number_id?: string } } }> };

export async function POST(req: Request) {
  const rl = await rateLimit(`metawa:${clientIp(req)}`, 1200, 60);
  if (!rl.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  const [cod, crm] = await Promise.all([activeService("meta_whatsapp"), activeService("crm_whatsapp")]);
  if (!cod?.appSecret && !crm?.appSecret) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const raw = await req.text();
  if (raw.length > 256_000) return NextResponse.json({ error: "too_large" }, { status: 413 });
  const sig = (req.headers.get("x-hub-signature-256") ?? "").replace(/^sha256=/, "");
  const signedBy = (secret?: string) => !!sig && !!secret && safeEqual(sig, hmacSha256Hex(secret, raw));
  const codOk = signedBy(cod?.appSecret), crmOk = signedBy(crm?.appSecret);
  if (!codOk && !crmOk) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "bad_json" }, { status: 400 }); }

  const crmPhone = crmOk ? crm!.phoneNumberId : "";
  const results: string[] = [];
  if (crmPhone) {
    const r = await handleCrmWebhook(body, crmPhone);
    results.push(`crm:${r.messages}m/${r.statuses}s`);
  }
  if (codOk) {
    // the COD / shipment flow sees only events that are not for the CRM number
    const entries = (Array.isArray(body.entry) ? body.entry : []) as Entry[];
    const rest = entries.map((e) => ({ ...e, changes: (e.changes ?? []).filter((c) => !crmPhone || c.value?.metadata?.phone_number_id !== crmPhone) })).filter((e) => e.changes.length);
    if (rest.length) results.push((await handleMetaWebhook({ ...body, entry: rest })).result);
  }
  return NextResponse.json({ ok: true, result: results.join(",") || "ignored:empty" });
}
