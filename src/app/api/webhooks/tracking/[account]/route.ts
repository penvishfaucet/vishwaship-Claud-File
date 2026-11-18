import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { getAdapter, providerContext } from "@/server/providers/registry";
import { clientIp, rateLimit } from "@/server/security/rate-limit";
import { safeEqual } from "@/server/security/crypto";
import { ingestPushed } from "@/server/tracking/service";
import { newId } from "@/server/util/ids";

/**
 * Carrier tracking push: POST https://<APP_URL>/api/webhooks/tracking/<providerAccountId>?token=<webhookToken>
 * - The token is the shared secret saved (encrypted) on that provider account; compared in constant time.
 * - Only adapters with a documented push format (parseTrackingWebhook) accept pushes; others are polled.
 * - Identical bodies are processed once (inbound_events); events are deduped per shipment as well, and
 *   older scans never overwrite a newer state (see ingestEvents).
 */
export async function POST(req: Request, { params }: { params: Promise<{ account: string }> }) {
  const rl = await rateLimit(`trkpush:${clientIp(req)}`, 1200, 60);
  if (!rl.ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  const { account } = await params;
  const db = await getDb();
  const [acct] = await db.select().from(schema.providerAccounts).where(eq(schema.providerAccounts.id, account.slice(0, 64)));
  const ad = acct && acct.category === "shipping" ? getAdapter(acct.adapter) : null;
  if (!acct || !ad || acct.status === "archived") return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!ad.parseTrackingWebhook) return NextResponse.json({ error: "push_not_supported", message: `${acct.label} updates are fetched by polling` }, { status: 422 });
  const expected = String((await providerContext(acct)).secrets.webhookToken ?? "");
  const got = new URL(req.url).searchParams.get("token") ?? req.headers.get("x-webhook-token") ?? "";
  const demoDev = acct.adapter === "demo" && process.env.NODE_ENV !== "production" && !expected;
  if (!demoDev && (!expected || !got || !safeEqual(expected, got))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const raw = await req.text();
  if (raw.length > 512_000) return NextResponse.json({ error: "too_large" }, { status: 413 });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: "bad_json" }, { status: 400 }); }
  const parsed = ad.parseTrackingWebhook(body);
  if (!parsed.ok) return NextResponse.json({ error: "invalid_payload", message: parsed.error.message }, { status: 400 });
  const key = `trk:${acct.id}:${createHash("sha256").update(raw).digest("hex")}`;
  const ins = await db.insert(schema.inboundEvents).values({ id: newId("ie"), provider: acct.adapter, dedupeKey: key, verified: true, payloadRedacted: { updates: parsed.value.length, awbs: parsed.value.slice(0, 20).map((u) => u.awb) } }).onConflictDoNothing().returning({ id: schema.inboundEvents.id });
  if (!ins.length) return NextResponse.json({ ok: true, duplicate: true });
  try {
    const r = await ingestPushed(acct.adapter, parsed.value);
    await db.update(schema.inboundEvents).set({ processedAt: new Date(), error: r.unknown ? `${r.unknown} unknown AWB(s)` : null }).where(eq(schema.inboundEvents.id, ins[0].id));
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    // let the provider retry: forget the dedupe row so the same body is processed next time
    await db.delete(schema.inboundEvents).where(eq(schema.inboundEvents.id, ins[0].id));
    return NextResponse.json({ error: "processing_failed", message: (e as Error).message.slice(0, 200) }, { status: 500 });
  }
}
