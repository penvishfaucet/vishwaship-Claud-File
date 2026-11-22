import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { dbLedgerStore } from "@/server/ledger/db-store";
import { debit } from "@/server/ledger/wallet";
import { getSetting } from "@/server/quotes/service";

/**
 * Vishwaship platform fee on Online Store orders (owner 2026-11-23): 1.5% of the order value on DELIVERED orders only,
 * plus GST, taken from the merchant's wallet once per order. RTO, lost and cancelled orders are never charged.
 * The rate is the setting "store_fee_bps" (default 150 = 1.5%).
 */
export const STORE_FEE_DEFAULT_BPS = 150;

/** Pure: fee and its GST for an order value (paise). */
export function storeFee(orderPaise: number, feeBps: number, gstBps: number) {
  const fee = Math.round((Math.max(0, orderPaise) * feeBps) / 10_000);
  const gst = Math.round((fee * gstBps) / 10_000);
  return { feePaise: fee, gstPaise: gst, totalPaise: fee + gst };
}

/** Background: charge the fee for every store order whose shipment is delivered and not yet charged. */
export async function sweepStoreFees(limit = 200) {
  const db = await getDb();
  const O = schema.storeOrders, S = schema.shipments;
  const rows = await db.select({ o: O }).from(O).innerJoin(S, eq(S.orderId, O.shippingOrderId))
    .where(and(isNull(O.feeChargedAt), eq(O.status, "placed"), eq(S.status, "delivered"), eq(S.bookingStatus, "confirmed"))).limit(limit);
  if (!rows.length) return 0;
  const feeBps = (await getSetting<number>("store_fee_bps", STORE_FEE_DEFAULT_BPS)).value;
  const gstBps = (await getSetting<number>("gst_bps", 1800)).value;
  let n = 0;
  for (const { o } of rows) {
    const f = storeFee(o.totalPaise, feeBps, gstBps);
    if (f.totalPaise <= 0) {
      await db.update(O).set({ feeChargedAt: new Date(), feePaise: 0, feeGstPaise: 0 }).where(and(eq(O.id, o.id), isNull(O.feeChargedAt)));
      continue;
    }
    const [w] = await db.select().from(schema.wallets).where(eq(schema.wallets.orgId, o.orgId));
    if (!w) continue;
    await db.transaction(async (tx) => {
      const [locked] = await tx.select({ at: O.feeChargedAt }).from(O).where(eq(O.id, o.id)).for("update");
      if (locked?.at) return;
      // a delivered order is always charged (the wallet may go below zero; new bookings then need a recharge)
      await debit(dbLedgerStore(tx), {
        walletId: w.id, amount: f.totalPaise, kind: "store_fee", allowNegative: true, idempotencyKey: `storefee:${o.id}`, refType: "store_order", refId: o.id,
        memo: `Online Store fee ${feeBps / 100}% on delivered order ${o.number} (incl. GST)`,
      });
      await tx.update(O).set({ feeChargedAt: new Date(), feePaise: f.totalPaise, feeGstPaise: f.gstPaise }).where(eq(O.id, o.id));
      n++;
    });
  }
  return n;
}

/** Fees charged to one store in a date range (for its P&L and statements). */
export async function feesCharged(orgId: string, from: Date, to: Date) {
  const db = await getDb();
  const [r] = await db.select({ total: sql<number>`coalesce(sum(${schema.storeOrders.feePaise}), 0)::bigint`, gst: sql<number>`coalesce(sum(${schema.storeOrders.feeGstPaise}), 0)::bigint`, n: sql<number>`count(*) filter (where ${schema.storeOrders.feePaise} > 0)::int` })
    .from(schema.storeOrders).where(and(eq(schema.storeOrders.orgId, orgId), sql`${schema.storeOrders.feeChargedAt} >= ${from} and ${schema.storeOrders.feeChargedAt} <= ${to}`));
  return { totalPaise: Number(r?.total ?? 0), gstPaise: Number(r?.gst ?? 0), orders: Number(r?.n ?? 0) };
}
