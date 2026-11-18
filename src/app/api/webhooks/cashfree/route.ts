import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { cashfreePayments, verifyCashfreeWebhook } from "@/server/payments/cashfree";
import { settleOnline } from "@/server/payments/recharge";
import { clientIp, rateLimit } from "@/server/security/rate-limit";
import { newId } from "@/server/util/ids";

/**
 * Cashfree payment webhook (PAYMENT_SUCCESS_WEBHOOK / PAYMENT_FAILED_WEBHOOK / PAYMENT_USER_DROPPED_WEBHOOK).
 * Signature checked on the RAW body; each delivery processed once; the payment is re-read from the
 * Cashfree API before any money moves.
 */
export async function POST(req: Request) {
  if (!(await rateLimit(`cfwh:${clientIp(req)}`, 600, 60)).ok) return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  const raw = await req.text();
  if (raw.length > 256_000) return NextResponse.json({ error: "too_large" }, { status: 413 });
  const ok = await verifyCashfreeWebhook(raw, req.headers.get("x-webhook-timestamp"), req.headers.get("x-webhook-signature"));
  if (!ok) return NextResponse.json({ error: "invalid signature" }, { status: 400 });
  let evt: { type?: string; data?: { order?: { order_id?: string }; payment?: { cf_payment_id?: string | number; payment_status?: string } } };
  try { evt = JSON.parse(raw); } catch { return NextResponse.json({ error: "bad_json" }, { status: 400 }); }
  const orderId = evt.data?.order?.order_id ?? "";
  const paymentId = String(evt.data?.payment?.cf_payment_id ?? "");
  const db = await getDb();
  const ins = await db.insert(schema.inboundEvents).values({ id: newId("ie"), provider: "cashfree", dedupeKey: `cashfree:${evt.type}:${orderId}:${paymentId}:${evt.data?.payment?.payment_status ?? ""}`, verified: true, payloadRedacted: { type: evt.type, orderId, paymentId } })
    .onConflictDoNothing().returning({ id: schema.inboundEvents.id });
  if (!ins.length) return NextResponse.json({ ok: true, duplicate: true });
  const [rc] = orderId ? await db.select().from(schema.recharges).where(eq(schema.recharges.providerOrderId, orderId)) : [];
  if (!rc || rc.method !== "cashfree") {
    await db.update(schema.inboundEvents).set({ processedAt: new Date(), error: "unknown order" }).where(eq(schema.inboundEvents.id, ins[0].id));
    return NextResponse.json({ ok: true, ignored: true });
  }
  try {
    const pays = await cashfreePayments(orderId);
    const p = pays.find((x) => String(x.cf_payment_id) === paymentId) ?? pays.find((x) => x.payment_status === "SUCCESS");
    if (p) {
      const outcome = p.payment_status === "SUCCESS" ? "success" : ["FAILED", "USER_DROPPED", "CANCELLED", "VOID"].includes(p.payment_status) ? "failed" : "pending";
      await settleOnline(rc.id, { paymentId: String(p.cf_payment_id), amountPaise: Math.round(Number(p.payment_amount) * 100), currency: p.payment_currency, outcome, source: "webhook" });
    }
    await db.update(schema.inboundEvents).set({ processedAt: new Date() }).where(eq(schema.inboundEvents.id, ins[0].id));
    return NextResponse.json({ ok: true });
  } catch (e) {
    // let Cashfree retry: forget this delivery so the retry is processed
    await db.delete(schema.inboundEvents).where(eq(schema.inboundEvents.id, ins[0].id));
    return NextResponse.json({ error: (e as Error).message.slice(0, 200) }, { status: 500 });
  }
}
