import { NextResponse } from "next/server";
import { activeService } from "@/server/integrations/services";
import { queueLead } from "@/server/marketing/meta-leads";
import { clientIp, rateLimit } from "@/server/security/rate-limit";
import { hmacSha256Hex, safeEqual } from "@/server/security/crypto";

/**
 * Meta Lead Ads webhook: <site>/api/webhooks/meta-leads (Page subscribed to the "leadgen" field).
 * GET  — Meta's one-time verification (hub.verify_token must equal the verify token saved in Admin).
 * POST — new-lead events, signed with the app secret (X-Hub-Signature-256). Each lead ID becomes one job that reads
 *        the lead and appends it to the Google Sheet; the 5-minute poll catches anything a webhook missed.
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const v = await activeService("meta_leads");
  const token = u.searchParams.get("hub.verify_token") ?? "";
  if (u.searchParams.get("hub.mode") === "subscribe" && v?.verifyToken && token && safeEqual(v.verifyToken, token)) {
    return new NextResponse(u.searchParams.get("hub.challenge") ?? "", { status: 200, headers: { "content-type": "text/plain" } });
  }
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}

export async function POST(req: Request) {
  const rl = await rateLimit(`metaleads:${clientIp(req)}`, 600, 60);
  if (!rl.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  const v = await activeService("meta_leads");
  if (!v?.appSecret) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  const raw = await req.text();
  if (raw.length > 256_000) return NextResponse.json({ error: "too_large" }, { status: 413 });
  const sig = (req.headers.get("x-hub-signature-256") ?? "").replace(/^sha256=/, "");
  if (!sig || !safeEqual(sig, hmacSha256Hex(v.appSecret, raw))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: { entry?: Array<{ id?: string; changes?: Array<{ field?: string; value?: { leadgen_id?: string | number; page_id?: string | number } }> }> };
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "bad_json" }, { status: 400 }); }
  let queued = 0;
  for (const e of body.entry ?? []) {
    for (const c of e.changes ?? []) {
      if (c.field !== "leadgen" || !c.value?.leadgen_id) continue;
      if (String(c.value.page_id ?? e.id ?? "") !== v.pageId) continue; // only our Page
      await queueLead(String(c.value.leadgen_id));
      queued++;
    }
  }
  return NextResponse.json({ ok: true, queued });
}
