import "server-only";
import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { dbLedgerStore } from "@/server/ledger/db-store";
import { debit } from "@/server/ledger/wallet";
import { getSetting } from "@/server/quotes/service";

/**
 * Vishwaship platform fee on Online Store orders (owner 2026-11-23): 1.5% of the order value on DELIVERED orders only,
 * plus GST, once per order. RTO, lost and cancelled orders are never charged.
 *   prepaid  the buyer paid into the merchant's own gateway, so the fee is taken from the Vishwaship wallet (sweep below)
 *   COD      Vishwaship holds the cash: the fee is deducted from the COD remittance (codFeesFor, paid D+5)
 * The rate is the setting "store_fee_bps" (default 150 = 1.5%).
 */
export const STORE_FEE_DEFAULT_BPS = 150;

/** Pure: fee and its GST for an order value (paise). */
export function storeFee(orderPaise: number, feeBps: number, gstBps: number) {
  const fee = Math.round((Math.max(0, orderPaise) * feeBps) / 10_000);
  const gst = Math.round((fee * gstBps) / 10_000);
  return { feePaise: fee, gstPaise: gst, totalPaise: fee + gst };
}

/** Background: charge the fee from the wallet for every delivered PREPAID store order not yet charged. */
export async function sweepStoreFees(limit = 200) {
  const db = await getDb();
  const O = schema.storeOrders, S = schema.shipments;
  const rows = await db.select({ o: O }).from(O).innerJoin(S, eq(S.orderId, O.shippingOrderId))
    .where(and(isNull(O.feeChargedAt), eq(O.status, "placed"), ne(O.paymentMethod, "cod"), eq(S.status, "delivered"), eq(S.bookingStatus, "confirmed"))).limit(limit);
  if (!rows.length) return 0;
  const feeBps = (await getSetting<number>("store_fee_bps", STORE_FEE_DEFAULT_BPS)).value;
  const gstBps = (await getSetting<number>("gst_bps", 1800)).value;
  let n = 0;
  for (const { o } of rows) {
    const f = storeFee(o.totalPaise, feeBps, gstBps);
    if (f.totalPaise <= 0) {
      await db.update(O).set({ feeChargedAt: new Date(), feePaise: 0, feeGstPaise: 0, feeVia: "wallet" }).where(and(eq(O.id, o.id), isNull(O.feeChargedAt)));
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
      await tx.update(O).set({ feeChargedAt: new Date(), feePaise: f.totalPaise, feeGstPaise: f.gstPaise, feeVia: "wallet" }).where(eq(O.id, o.id));
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

type Q = Awaited<ReturnType<typeof getDb>> | Parameters<Parameters<Awaited<ReturnType<typeof getDb>>["transaction"]>[0]>[0];

/**
 * COD remittance: the fee on the delivered COD store orders among these shipments. Orders charged before (by an earlier,
 * cancelled remittance) keep their amount; orders that existed before the fee started are skipped.
 * With `mark`, the orders are recorded as charged through the remittance (inside the caller's transaction).
 */
/** Fee rates, read before a transaction (a setting read inside one would use a second connection). */
export async function feeRates() {
  return { feeBps: (await getSetting<number>("store_fee_bps", STORE_FEE_DEFAULT_BPS)).value, gstBps: (await getSetting<number>("gst_bps", 1800)).value };
}

export async function codFeesFor(q: Q, shipmentIds: string[], rates: { feeBps: number; gstBps: number }, mark = false) {
  if (!shipmentIds.length) return { totalPaise: 0, gstPaise: 0, orders: 0 };
  const O = schema.storeOrders, S = schema.shipments;
  const rows = await q.select({ o: O }).from(O).innerJoin(S, eq(S.orderId, O.shippingOrderId))
    .where(and(inArray(S.id, shipmentIds), eq(O.status, "placed"), eq(O.paymentMethod, "cod"), or(isNull(O.feeChargedAt), eq(O.feeVia, "cod"))));
  if (!rows.length) return { totalPaise: 0, gstPaise: 0, orders: 0 };
  const { feeBps, gstBps } = rates;
  let total = 0, gst = 0, n = 0;
  for (const { o } of rows) {
    const f = o.feeVia === "cod" && o.feePaise !== null ? { totalPaise: o.feePaise, gstPaise: o.feeGstPaise ?? 0 } : storeFee(o.totalPaise, feeBps, gstBps);
    if (f.totalPaise <= 0) continue;
    total += f.totalPaise; gst += f.gstPaise; n++;
    if (mark && o.feeVia !== "cod") await q.update(O).set({ feeChargedAt: new Date(), feePaise: f.totalPaise, feeGstPaise: f.gstPaise, feeVia: "cod" }).where(eq(O.id, o.id));
  }
  return { totalPaise: total, gstPaise: gst, orders: n };
}
