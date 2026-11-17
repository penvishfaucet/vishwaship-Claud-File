import { NextResponse } from "next/server";
import { getDb, schema } from "@/server/db/client";
import { applyCapturedPayment, fetchPayment, verifyWebhookSignature } from "@/server/payments/razorpay";
import { newId } from "@/server/util/ids";

/** Inbound Razorpay webhook. Signature is checked against the RAW body; events are deduped by event id. */
export async function POST(req: Request) {
  const raw = await req.text();
  const ok = await verifyWebhookSignature(raw, req.headers.get("x-razorpay-signature"));
  if (!ok) return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  const evt = JSON.parse(raw) as { event: string; payload?: { payment?: { entity?: { id: string } } } };
  const eventId = req.headers.get("x-razorpay-event-id") ?? `${evt.event}:${evt.payload?.payment?.entity?.id}`;
  const db = await getDb();
  const ins = await db.insert(schema.inboundEvents).values({ id: newId("ie"), provider: "razorpay", dedupeKey: `razorpay:${eventId}`, verified: true, payloadRedacted: { event: evt.event, paymentId: evt.payload?.payment?.entity?.id } }).onConflictDoNothing().returning();
  if (!ins.length) return NextResponse.json({ ok: true, duplicate: true });
  if ((evt.event === "payment.captured" || evt.event === "order.paid") && evt.payload?.payment?.entity?.id) {
    // Corroborate with the source before moving money.
    const payment = await fetchPayment(evt.payload.payment.entity.id);
    await applyCapturedPayment(payment, "webhook");
  }
  return NextResponse.json({ ok: true });
}
