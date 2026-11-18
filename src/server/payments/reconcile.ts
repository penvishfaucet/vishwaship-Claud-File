import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { cashfreeOrderStatus, cashfreePayments } from "./cashfree";
import { reconcileRazorpay } from "./razorpay";
import { rechargeEvent, settleOnline } from "./recharge";

/**
 * Ask the gateway what happened to a pending online recharge (customer closed checkout, redirect lost,
 * webhook delayed). Credits through settleOnline (exactly once) or marks failed/expired.
 */
export async function reconcileRecharge(rechargeId: string) {
  const db = await getDb();
  const [rc] = await db.select().from(schema.recharges).where(eq(schema.recharges.id, rechargeId));
  if (!rc || rc.status !== "payment_pending") return rc?.status ?? null;
  try {
    if (rc.method === "razorpay" && rc.razorpayOrderId) await reconcileRazorpay(rc.razorpayOrderId);
    if (rc.method === "cashfree" && rc.providerOrderId) {
      const pays = await cashfreePayments(rc.providerOrderId);
      const ok = pays.find((p) => p.payment_status === "SUCCESS");
      if (ok) await settleOnline(rc.id, { paymentId: String(ok.cf_payment_id), amountPaise: Math.round(Number(ok.payment_amount) * 100), currency: ok.payment_currency, outcome: "success", source: "reconcile" });
      else {
        const st = await cashfreeOrderStatus(rc.providerOrderId);
        if (st === "EXPIRED" || st === "TERMINATED") {
          const upd = await db.update(schema.recharges).set({ status: "expired", updatedAt: new Date() }).where(eq(schema.recharges.id, rc.id)).returning({ id: schema.recharges.id });
          if (upd.length) await rechargeEvent(rc.id, "gateway_failed", "gateway", null, `Cashfree order ${st.toLowerCase()}`);
        } else if (pays.length && pays.every((p) => ["FAILED", "USER_DROPPED", "CANCELLED", "VOID"].includes(p.payment_status))) {
          const last = pays[pays.length - 1];
          await settleOnline(rc.id, { paymentId: String(last.cf_payment_id), amountPaise: Math.round(Number(last.payment_amount) * 100), currency: last.payment_currency, outcome: "failed", source: "reconcile" });
        }
      }
    }
  } catch { /* gateway unreachable: stays Payment Pending; webhook or a later check settles it */ }
  const [after] = await db.select({ status: schema.recharges.status }).from(schema.recharges).where(eq(schema.recharges.id, rechargeId));
  return after?.status ?? null;
}
