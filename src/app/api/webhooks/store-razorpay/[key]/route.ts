import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { newId } from "@/server/util/ids";
import { applyPayment } from "@/server/store/checkout";
import { orgByWebhookKey, verifyMerchantWebhook, type RzPayment } from "@/server/store/razorpay";

/**
 * Merchant's Razorpay webhook (payment.captured / order.paid) for store orders. The URL key identifies the merchant;
 * the body must carry a valid X-Razorpay-Signature made with that merchant's webhook secret. Each event is processed
 * once (inbound_events dedupe on X-Razorpay-Event-Id); applyPayment is idempotent as well.
 */
export async function POST(req: Request, ctx: { params: Promise<{ key: string }> }) {
  const { key } = await ctx.params;
  const orgId = await orgByWebhookKey(key);
  if (!orgId) return NextResponse.json({ ok: false }, { status: 404 });
  const raw = await req.text();
  if (raw.length > 200_000) return NextResponse.json({ ok: false }, { status: 413 });
  if (!(await verifyMerchantWebhook(orgId, raw, req.headers.get("x-razorpay-signature")))) return NextResponse.json({ ok: false }, { status: 401 });
  let evt: { event?: string; payload?: { payment?: { entity?: RzPayment } } };
  try { evt = JSON.parse(raw); } catch { return NextResponse.json({ ok: false }, { status: 400 }); }
  const p = evt.payload?.payment?.entity;
  const eventId = req.headers.get("x-razorpay-event-id") ?? `${evt.event}:${p?.id ?? ""}`;
  const db = await getDb();
  const ins = await db.insert(schema.inboundEvents).values({ id: newId("ie"), provider: "store_razorpay", dedupeKey: `store_razorpay:${orgId}:${eventId}`, verified: true, payloadRedacted: { event: evt.event, paymentId: p?.id ?? null, orderId: p?.order_id ?? null } })
    .onConflictDoNothing().returning({ id: schema.inboundEvents.id });
  if (!ins.length) return NextResponse.json({ ok: true, duplicate: true });
  let error: string | null = null;
  if ((evt.event === "payment.captured" || evt.event === "order.paid") && p?.order_id) {
    const r = await applyPayment(orgId, p, "webhook");
    if (!r.ok) error = r.message;
  }
  await db.update(schema.inboundEvents).set({ processedAt: new Date(), error }).where(eq(schema.inboundEvents.id, ins[0].id));
  return NextResponse.json({ ok: true });
}
