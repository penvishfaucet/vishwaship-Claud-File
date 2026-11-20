import { modeAllowed, paymentConfig } from "@/server/payment-modes";
import { isNszError, nszMessage, rememberNsz } from "@/server/carriers/nsz";
import type { PaymentMode } from "@/server/providers/types";
import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { audit } from "@/server/audit";
import { InsufficientBalanceError, release, reserve, settle } from "@/server/ledger/wallet";
import { withLedger } from "@/server/ledger/db-store";
import { adapterFor, providerContext } from "@/server/providers/registry";
import type { BookRequest, QuoteRequest } from "@/server/providers/types";
import { getQuotes, quotesByIds, sameService } from "@/server/quotes/service";
import { canTakeBookings, noteCapability } from "@/server/carriers/verification";
import { registerWarehouseAt } from "@/server/carriers/automation";
import { hideProviders } from "@/server/customer-safe";
import { ACTIVATION_MESSAGE, onboardingState } from "@/server/onboarding";
import { courierEmail } from "@/server/client-email";

/** Comparable view of a quote request (field order and optional defaults normalised). */
function normReq(r: QuoteRequest) {
  return { m: r.mode, o: r.originPincode, d: r.destinationPincode, p: r.paymentType, c: r.codAmount ?? 0, v: r.declaredValue ?? 0, r: r.direction ?? "forward",
    k: r.packages.map((x) => [x.count, x.lengthMm, x.breadthMm, x.heightMm, x.actualWeightGrams]) };
}
import { newId } from "@/server/util/ids";

export type BookOutcome =
  | { ok: true; shipmentId: string; awb: string | null; state: "confirmed" | "pending_async" }
  | { ok: false; code: "not_found" | "quote_expired" | "quote_mismatch" | "insufficient_balance" | "cod_hold" | "already_booked" | "provider_failed" | "ambiguous" | "unsupported"; message: string }
  | { ok: false; code: "price_changed"; message: string; newQuoteId: string; oldTotal: number; newTotal: number };

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
/** Customer-facing: messages never name the aggregator behind a quote. */
export async function bookOrder(args: { orgId: string; orderId: string; quoteId: string; actorUserId: string }): Promise<BookOutcome> {
  const r = await bookOrderInner(args);
  return r.ok ? r : { ...r, message: hideProviders(r.message) };
}

async function bookOrderInner(args: { orgId: string; orderId: string; quoteId: string; actorUserId: string }): Promise<BookOutcome> {
  const db = await getDb();
  const [order] = await db.select().from(schema.orders).where(and(eq(schema.orders.id, args.orderId), eq(schema.orders.orgId, args.orgId)));
  if (!order) return { ok: false, code: "not_found", message: "Order not found" };
  if (order.status === "cod_hold") return { ok: false, code: "cod_hold", message: "Waiting for buyer COD confirmation on WhatsApp" };
  if (["booked", "booking"].includes(order.status)) return { ok: false, code: "already_booked", message: "This order is already booked or being booked" };
  if (order.status === "needs_reconcile") return { ok: false, code: "ambiguous", message: "A previous booking attempt is being reconciled with the courier. Please wait." };
  // Account must be Active (profile complete + KYC approved by Admin) before any booking.
  const ob = await onboardingState(args.orgId);
  // KYC is not needed to book (accounts without approved KYC see the non-KYC margin); the business profile is
  if (ob.step === "profile") return { ok: false, code: "unsupported", message: ACTIVATION_MESSAGE.profile };

  const [quote] = await db.select().from(schema.quotes).where(and(eq(schema.quotes.id, args.quoteId), eq(schema.quotes.orgId, args.orgId)));
  if (!quote) return { ok: false, code: "not_found", message: "Quote not found" };
  // A surcharge (e.g. ODA) whose amount the carrier has not confirmed: never book at an unverified rate.
  const pendingReason = (quote.priced as { pending?: string }).pending;
  if (pendingReason) return { ok: false, code: "unsupported", message: `Rate pending confirmation — ${pendingReason}. This service cannot be booked until the charge is confirmed; choose another courier or try again later.` };
  const entered = order.consignee as BookRequest["consignee"];
  // couriers require a receiver email; it is optional for our customers → the client's own account email is sent instead
  const consignee: BookRequest["consignee"] = { ...entered, email: await courierEmail(args.orgId, entered.email) };

  const [acct] = await db.select().from(schema.providerAccounts).where(eq(schema.providerAccounts.id, quote.providerAccountId!));
  const pilots = ((acct?.configPublic as Record<string, unknown> | undefined)?.pilotOrgIds as string[] | undefined) ?? [];
  if (!acct || !((acct.status === "enabled" && canTakeBookings(acct)) || (acct.status === "disabled" && pilots.includes(args.orgId)))) {
    return { ok: false, code: "unsupported", message: acct?.status === "paused" ? "This courier service is paused for new bookings. Choose another courier." : "This courier account is not accepting new bookings." };
  }

  // Expired quote, or order details changed since quoting: re-check the same provider service before charging.
  const [whNow] = order.warehouseId ? await db.select().from(schema.warehouses).where(eq(schema.warehouses.id, order.warehouseId)) : [];
  const qreq = quote.request as QuoteRequest;
  const pkgNow = await db.select().from(schema.packages).where(eq(schema.packages.orderId, order.id));
  const reqNow: QuoteRequest = {
    mode: order.mode as "B2C" | "B2B", originPincode: whNow?.pincode ?? qreq.originPincode, destinationPincode: consignee.pincode, paymentType: order.paymentType as PaymentMode,
    codAmount: order.codAmountPaise, declaredValue: order.declaredValuePaise, direction: order.direction as "forward" | "reverse",
    packages: pkgNow.map((p) => ({ count: p.count, lengthMm: p.lengthMm, breadthMm: p.breadthMm, heightMm: p.heightMm, actualWeightGrams: p.actualWeightGrams })),
  };
  const changed = JSON.stringify(normReq(qreq)) !== JSON.stringify(normReq(reqNow));
  if (quote.expiresAt.getTime() < Date.now() || changed) {
    const fresh = await getQuotes(reqNow, args.orgId, { onlyAccountId: acct.id });
    const prev = { carrierCode: quote.carrierCode, serviceName: quote.serviceName, providerQuoteRef: (quote.priced as { providerQuoteRef?: string }).providerQuoteRef };
    const rows = await quotesByIds(fresh.offers.map((o) => o.quoteId));
    const matchRow = rows.find((r) => sameService(prev, { carrierCode: r.carrierCode, serviceName: r.serviceName, providerQuoteRef: (r.priced as { providerQuoteRef?: string }).providerQuoteRef }));
    if (!matchRow) return { ok: false, code: "quote_expired", message: `${quote.serviceName} is no longer available for this shipment — refresh rates and choose again.` };
    if ((matchRow.priced as { pending?: string }).pending) return { ok: false, code: "unsupported", message: `Rate pending confirmation — ${(matchRow.priced as { pending?: string }).pending}. Choose another courier or try again later.` };
    if (matchRow.totalPaise !== quote.totalPaise) {
      return { ok: false, code: "price_changed", message: `The rate for ${quote.serviceName} changed from ₹${(quote.totalPaise / 100).toFixed(2)} to ₹${(matchRow.totalPaise / 100).toFixed(2)}. Confirm the new price to book.`, newQuoteId: matchRow.id, oldTotal: quote.totalPaise, newTotal: matchRow.totalPaise };
    }
    return bookOrder({ ...args, quoteId: matchRow.id }); // same price: continue with the fresh quote
  }
  const adapter = adapterFor(acct);
  if (!adapter) return { ok: false, code: "unsupported", message: "Adapter required" };

  const [wallet] = await db.select().from(schema.wallets).where(eq(schema.wallets.orgId, args.orgId));
  const [wh] = order.warehouseId ? await db.select().from(schema.warehouses).where(and(eq(schema.warehouses.id, order.warehouseId), eq(schema.warehouses.orgId, args.orgId))) : [];
  if (!wh || !wh.active) return { ok: false, code: "not_found", message: "Select an active pickup address" };
  if (!wh.mobileVerifiedAt && (await (await import("@/server/warehouses")).pickupOtpRequired())) return { ok: false, code: "not_found", message: "Verify the pickup mobile number with OTP before booking" };

  // Payment mode must be enabled for this carrier account (Admin → Carrier Integrations) — enforced here, not only in the UI.
  const pay = paymentConfig(acct, adapter);
  const modeOk = modeAllowed(pay, order.paymentType as PaymentMode);
  if (!modeOk.ok) return { ok: false, code: "unsupported", message: modeOk.reason };
  const pricedQ = quote.priced as { payer?: { sender: number; receiver: number; basis: string } };
  const senderPays = pricedQ.payer?.sender ?? quote.totalPaise;
  const receiverPays = pricedQ.payer?.receiver ?? 0;

  // Carrier pickup location (registered once per warehouse + carrier account).
  let providerWarehouseRef: string | undefined;
  if (adapter.registerWarehouse) {
    const reg = await registerWarehouseAt(wh, acct);
    if (!reg.ok) return { ok: false, code: "provider_failed", message: `Could not register this pickup address with the courier partner: ${reg.error.message}` };
    providerWarehouseRef = reg.value.ref ?? undefined;
  }

  // Claim the order (prevents double-submit races).
  const claimed = await db.update(schema.orders).set({ status: "booking" })
    .where(and(eq(schema.orders.id, order.id), eq(schema.orders.status, order.status))).returning({ id: schema.orders.id });
  if (!claimed.length) return { ok: false, code: "already_booked", message: "This order is already being booked" };

  // FOD with the full rate collected from the receiver: nothing is held from the sender's wallet.
  const reservationId = senderPays > 0 ? `res_${order.id}_${quote.id}` : null;
  try {
    if (reservationId) await withLedger((s) => reserve(s, { walletId: wallet.id, amount: senderPays, reservationId, idempotencyKey: `reserve:${reservationId}`, refType: "order", refId: order.id, memo: `Hold for ${order.orderNumber}` }));
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
    mode: order.mode as "B2C" | "B2B", paymentType: order.paymentType as PaymentMode, codAmount: order.codAmountPaise,
    declaredValue: order.declaredValuePaise,
    pickup: { name: wh.contactName, mobile: wh.mobile, line1: wh.line1, line2: wh.line2 ?? undefined, pincode: wh.pincode, city: wh.city, state: wh.state, providerWarehouseRef },
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
    if (reservationId) await withLedger((s) => release(s, { walletId: wallet.id, reservationId, idempotencyKey: `release:${reservationId}`, refType: "order", refId: order.id, memo: `Released: ${order.orderNumber} not booked` }));
    await db.update(schema.orders).set({ status: "booking_failed" }).where(eq(schema.orders.id, order.id));
    // "Destination Center is NSZ": the courier quoted but will not deliver to this PIN. Remember it so this
    // courier is not offered there again for a while, and tell the customer plainly what to do.
    if (isNszError(res.error.message)) {
      await rememberNsz(acct.adapter, consignee.pincode).catch(() => {});
      await audit({ actorUserId: args.actorUserId, actorKind: "customer", orgId: args.orgId, action: "booking.nsz", targetType: "order", targetId: order.id, details: { provider: acct.adapter, pin: consignee.pincode, message: res.error.message } });
      return { ok: false, code: "provider_failed", message: nszMessage(quote.serviceName || "This courier", consignee.pincode) };
    }
    return { ok: false, code: res.error.category === "unsupported" ? "unsupported" : "provider_failed", message: res.error.message };
  }

  const b = res.value;
  const shipmentId = newId("shp");
  await db.insert(schema.shipments).values({
    id: shipmentId, orgId: args.orgId, orderId: order.id, providerAccountId: acct.id, provider: acct.adapter,
    carrierCode: quote.carrierCode, carrierName: priced.carrierName, serviceName: quote.serviceName,
    providerOrderRef: b.providerOrderRef, awb: b.awb, lrNumber: b.lrNumber ?? null, pieceIds: b.pieceIds ?? null,
    bookingStatus: b.state === "confirmed" ? "confirmed" : "pending", labelStatus: b.labelAvailable ? "available" : "not_generated",
    pickupStatus: b.pickupRef || b.pickupScheduled ? "scheduled" : "not_scheduled", pickupRef: b.pickupRef ?? null,
    status: "booked", quoteId: quote.id, sellPaise: senderPays, costPaise: priced.costPreTax, reservationId,
    freightPayer: order.paymentType === "fod" ? "receiver" : "sender", receiverFreightPaise: receiverPays, fodStatus: order.paymentType === "fod" ? "pending_collection" : null,
    chargeableWeightGrams: priced.chargeableWeightGrams, etaDate: priced.etaDays ? new Date(Date.now() + priced.etaDays * 86400_000) : null,
  });
  if (b.carrierChargePaise != null) await recordCarrierCharge(shipmentId, b.carrierChargePaise, priced.costPreTax);
  if (b.state === "confirmed") {
    if (reservationId) await withLedger((s) => settle(s, { walletId: wallet.id, reservationId, idempotencyKey: `settle:${reservationId}`, refType: "shipment", refId: shipmentId, memo: `Shipping charge ${order.orderNumber}${b.awb ? ` · ${b.awb}` : ""}` }));
  } else {
    // Async manifestation (e.g. Delhivery B2B): keep the hold until lookup confirms.
    await db.insert(schema.jobs).values({ id: newId("job"), queue: "booking.reconcile", payload: { orderId: order.id, quoteId: quote.id, reservationId, shipmentId }, dedupeKey: `reconcile:${order.id}:${quote.id}` }).onConflictDoNothing();
  }
  await db.update(schema.orders).set({ status: "booked" }).where(eq(schema.orders.id, order.id));
  if (order.externalStoreId && b.awb && acct.adapter !== "demo") {
    await db.insert(schema.jobs).values({ id: newId("job"), queue: "store.push_tracking", payload: { orderId: order.id }, dedupeKey: `push:${order.id}` }).onConflictDoNothing();
  }
  await db.insert(schema.shipmentEvents).values({ id: newId("ev"), shipmentId, dedupeKey: `booked:${shipmentId}`, status: "booked", rawStatus: "BOOKED", occurredAt: new Date(), source: "manual" });
  if (b.pickupRef || b.pickupScheduled) await db.insert(schema.shipmentEvents).values({ id: newId("ev"), shipmentId, dedupeKey: `pickup_req:${shipmentId}`, status: "pickup_pending", rawStatus: b.pickupRef ? `Pickup scheduled (ref ${b.pickupRef})` : "Pickup scheduled automatically by the courier", occurredAt: new Date(), source: "manual" });
  // Couriers that need a pickup request (PR) get one automatically right after booking.
  if (!b.pickupRef && !b.pickupScheduled && adapter.implemented.includes("pickup") && acct.adapter !== "demo") {
    await db.insert(schema.jobs).values({ id: newId("job"), queue: "pickup.auto", payload: { shipmentId }, dedupeKey: `pickup.auto:${shipmentId}` }).onConflictDoNothing();
  }
  await noteCapability(acct.id, "book", true, { evidence: `shipment ${shipmentId}${b.awb ? ` · AWB ${b.awb}` : ""}` });
  if (b.pickupRef) await noteCapability(acct.id, "pickup", true, { evidence: `pickup ${b.pickupRef}` });
  await audit({ actorUserId: args.actorUserId, actorKind: "customer", orgId: args.orgId, action: "booking.created", targetType: "shipment", targetId: shipmentId, details: { quoteId: quote.id, totalPaise: quote.totalPaise, senderPays, receiverPays, paymentMode: order.paymentType, provider: acct.adapter, providerRef: b.providerOrderRef } });
  return { ok: true, shipmentId, awb: b.awb, state: b.state };
}

/**
 * The carrier reported what it actually charges for a shipment. A charge above the quoted carrier cost is flagged
 * for Admin (Order Exceptions); the customer is never charged above the amount they approved.
 */
export async function recordCarrierCharge(shipmentId: string, chargePaise: number, quotedCostPaise: number) {
  if (!Number.isFinite(chargePaise) || chargePaise < 0) return;
  const db = await getDb();
  const check = chargePaise > quotedCostPaise ? "higher" : "ok";
  await db.update(schema.shipments).set({ carrierChargePaise: Math.round(chargePaise), chargeCheck: check }).where(eq(schema.shipments.id, shipmentId));
  if (check === "higher") await audit({ actorKind: "system", action: "shipment.carrier_charge_higher", targetType: "shipment", targetId: shipmentId, details: { chargePaise, quotedCostPaise, differencePaise: chargePaise - quotedCostPaise } });
}
