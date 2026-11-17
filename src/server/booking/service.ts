import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { audit } from "@/server/audit";
import { InsufficientBalanceError, release, reserve, settle } from "@/server/ledger/wallet";
import { withLedger } from "@/server/ledger/db-store";
import { getAdapter, providerContext } from "@/server/providers/registry";
import type { BookRequest } from "@/server/providers/types";
import { newId } from "@/server/util/ids";

export type BookOutcome =
  | { ok: true; shipmentId: string; awb: string | null; state: "confirmed" | "pending_async" }
  | { ok: false; code: "not_found" | "quote_expired" | "quote_mismatch" | "insufficient_balance" | "cod_hold" | "already_booked" | "provider_failed" | "ambiguous" | "unsupported"; message: string };

/**
 * Book one order against a saved quote.
 *
 * 1. Revalidate: order belongs to org, is bookable, quote belongs to org + is unexpired + matches order.
 * 2. Reserve wallet funds (row-locked; insufficient balance -> stop).
 * 3. Call the provider with a stable idempotent reference (our order id).
 * 4. Success -> settle reservation (one debit) + persist shipment with provider refs.
 *    Definitive failure -> release reservation.
 *    Timeout / unknown -> keep the hold, mark the order needs_reconcile; a job calls lookupBooking()
 *    before anything is retried or rebooked elsewhere. No AWB is ever invented.
 */
export async function bookOrder(args: { orgId: string; orderId: string; quoteId: string; actorUserId: string }): Promise<BookOutcome> {
  const db = await getDb();
  const [order] = await db.select().from(schema.orders).where(and(eq(schema.orders.id, args.orderId), eq(schema.orders.orgId, args.orgId)));
  if (!order) return { ok: false, code: "not_found", message: "Order not found" };
  if (order.status === "cod_hold") return { ok: false, code: "cod_hold", message: "Waiting for buyer COD confirmation on WhatsApp" };
  if (["booked", "booking"].includes(order.status)) return { ok: false, code: "already_booked", message: "This order is already booked or being booked" };
  if (order.status === "needs_reconcile") return { ok: false, code: "ambiguous", message: "A previous booking attempt is being reconciled with the courier. Please wait." };

  const [quote] = await db.select().from(schema.quotes).where(and(eq(schema.quotes.id, args.quoteId), eq(schema.quotes.orgId, args.orgId)));
  if (!quote) return { ok: false, code: "not_found", message: "Quote not found" };
  if (quote.expiresAt.getTime() < Date.now()) return { ok: false, code: "quote_expired", message: "This quote has expired. Refresh rates before booking." };
  const qreq = quote.request as { originPincode: string; destinationPincode: string; paymentType: string; mode: string };
  const consignee = order.consignee as BookRequest["consignee"];
  if (qreq.destinationPincode !== consignee.pincode || qreq.paymentType !== order.paymentType || qreq.mode !== order.mode) {
    return { ok: false, code: "quote_mismatch", message: "Order details changed since the quote. Refresh rates." };
  }

  const [acct] = await db.select().from(schema.providerAccounts).where(eq(schema.providerAccounts.id, quote.providerAccountId!));
  if (!acct || acct.status !== "enabled") return { ok: false, code: "unsupported", message: "This courier account is not accepting new bookings." };
  const adapter = getAdapter(acct.adapter);
  if (!adapter) return { ok: false, code: "unsupported", message: "Adapter required" };

  const [wallet] = await db.select().from(schema.wallets).where(eq(schema.wallets.orgId, args.orgId));
  const [wh] = order.warehouseId ? await db.select().from(schema.warehouses).where(and(eq(schema.warehouses.id, order.warehouseId), eq(schema.warehouses.orgId, args.orgId))) : [];
  if (!wh || !wh.active) return { ok: false, code: "not_found", message: "Select an active pickup address" };
  if (!wh.mobileVerifiedAt) return { ok: false, code: "not_found", message: "Verify the pickup mobile number with OTP before booking" };

  // Claim the order (prevents double-submit races).
  const claimed = await db.update(schema.orders).set({ status: "booking" })
    .where(and(eq(schema.orders.id, order.id), eq(schema.orders.status, order.status))).returning({ id: schema.orders.id });
  if (!claimed.length) return { ok: false, code: "already_booked", message: "This order is already being booked" };

  const reservationId = `res_${order.id}_${quote.id}`;
  try {
    await withLedger((s) => reserve(s, { walletId: wallet.id, amount: quote.totalPaise, reservationId, idempotencyKey: `reserve:${reservationId}`, refType: "order", refId: order.id, memo: `Hold for ${order.orderNumber}` }));
  } catch (e) {
    await db.update(schema.orders).set({ status: order.status }).where(eq(schema.orders.id, order.id));
    if (e instanceof InsufficientBalanceError) return { ok: false, code: "insufficient_balance", message: "Insufficient wallet balance. Recharge to continue." };
    throw e;
  }

  const pkgs = await db.select().from(schema.packages).where(eq(schema.packages.orderId, order.id));
  const priced = quote.priced as { providerQuoteRef?: string; carrierName: string; costPreTax: number; chargeableWeightGrams: number; etaDays?: number };
  const ctx = await providerContext(acct);
  const req: BookRequest = {
    vishwashipOrderId: order.id, orderNumber: order.orderNumber,
    quote: { carrierCode: quote.carrierCode, serviceName: quote.serviceName, providerQuoteRef: priced.providerQuoteRef },
    mode: order.mode as "B2C" | "B2B", paymentType: order.paymentType as "prepaid" | "cod", codAmount: order.codAmountPaise,
    declaredValue: order.declaredValuePaise,
    pickup: { name: wh.contactName, mobile: wh.mobile, line1: wh.line1, line2: wh.line2 ?? undefined, pincode: wh.pincode, city: wh.city, state: wh.state },
    consignee, packages: pkgs.map((p) => ({ count: p.count, lengthMm: p.lengthMm, breadthMm: p.breadthMm, heightMm: p.heightMm, actualWeightGrams: p.actualWeightGrams })),
    products: (order.products as BookRequest["products"]) ?? [], invoiceNumber: order.invoiceNumber ?? undefined, ewayBill: order.ewayBill ?? undefined,
  };

  let res;
  try {
    res = await adapter.book(ctx, req);
  } catch (e) {
    res = { ok: false as const, error: { category: "ambiguous" as const, message: (e as Error).message, retryable: false } };
  }

  if (!res.ok) {
    const ambiguous = res.error.category === "timeout" || res.error.category === "ambiguous" || res.error.category === "upstream";
    if (ambiguous) {
      await db.update(schema.orders).set({ status: "needs_reconcile" }).where(eq(schema.orders.id, order.id));
      await db.insert(schema.jobs).values({ id: newId("job"), queue: "booking.reconcile", payload: { orderId: order.id, quoteId: quote.id, reservationId }, dedupeKey: `reconcile:${order.id}:${quote.id}` }).onConflictDoNothing();
      await audit({ actorUserId: args.actorUserId, actorKind: "customer", orgId: args.orgId, action: "booking.ambiguous", targetType: "order", targetId: order.id, details: { provider: acct.adapter, message: res.error.message } });
      return { ok: false, code: "ambiguous", message: "The courier did not confirm in time. Funds stay on hold while we check with the courier — no duplicate booking will be made." };
    }
    await withLedger((s) => release(s, { walletId: wallet.id, reservationId, idempotencyKey: `release:${reservationId}`, refType: "order", refId: order.id, memo: `Released: ${order.orderNumber} not booked` }));
    await db.update(schema.orders).set({ status: "booking_failed" }).where(eq(schema.orders.id, order.id));
    return { ok: false, code: res.error.category === "unsupported" ? "unsupported" : "provider_failed", message: res.error.message };
  }

  const b = res.value;
  const shipmentId = newId("shp");
  await db.insert(schema.shipments).values({
    id: shipmentId, orgId: args.orgId, orderId: order.id, providerAccountId: acct.id, provider: acct.adapter,
    carrierCode: quote.carrierCode, carrierName: priced.carrierName, serviceName: quote.serviceName,
    providerOrderRef: b.providerOrderRef, awb: b.awb, lrNumber: b.lrNumber ?? null, pieceIds: b.pieceIds ?? null,
    bookingStatus: b.state === "confirmed" ? "confirmed" : "pending", labelStatus: b.labelAvailable ? "available" : "not_generated",
    status: "booked", quoteId: quote.id, sellPaise: quote.totalPaise, costPaise: priced.costPreTax, reservationId,
    chargeableWeightGrams: priced.chargeableWeightGrams, etaDate: priced.etaDays ? new Date(Date.now() + priced.etaDays * 86400_000) : null,
  });
  if (b.state === "confirmed") {
    await withLedger((s) => settle(s, { walletId: wallet.id, reservationId, idempotencyKey: `settle:${reservationId}`, refType: "shipment", refId: shipmentId, memo: `Shipping charge ${order.orderNumber}${b.awb ? ` · ${b.awb}` : ""}` }));
  } else {
    // Async manifestation (e.g. Delhivery B2B): keep the hold until lookup confirms.
    await db.insert(schema.jobs).values({ id: newId("job"), queue: "booking.reconcile", payload: { orderId: order.id, quoteId: quote.id, reservationId, shipmentId }, dedupeKey: `reconcile:${order.id}:${quote.id}` }).onConflictDoNothing();
  }
  await db.update(schema.orders).set({ status: "booked" }).where(eq(schema.orders.id, order.id));
  if (order.externalStoreId && b.awb && acct.adapter !== "demo") {
    await db.insert(schema.jobs).values({ id: newId("job"), queue: "store.push_tracking", payload: { orderId: order.id }, dedupeKey: `push:${order.id}` }).onConflictDoNothing();
  }
  await db.insert(schema.shipmentEvents).values({ id: newId("ev"), shipmentId, dedupeKey: `booked:${shipmentId}`, status: "booked", rawStatus: "BOOKED", occurredAt: new Date(), source: "manual" });
  await audit({ actorUserId: args.actorUserId, actorKind: "customer", orgId: args.orgId, action: "booking.created", targetType: "shipment", targetId: shipmentId, details: { quoteId: quote.id, totalPaise: quote.totalPaise, provider: acct.adapter } });
  return { ok: true, shipmentId, awb: b.awb, state: b.state };
}
