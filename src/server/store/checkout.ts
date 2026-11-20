import "server-only";
import { and, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/server/db/client";
import { createOrder } from "@/server/orders/create";
import { newId, randomToken } from "@/server/util/ids";
import { readSettings } from "@/lib/store-themes";
import { createMerchantOrder, fetchMerchantPayment, merchantOrderPayments, razorpayOverview, razorpayReady, verifyMerchantSignature, type RzPayment } from "./razorpay";

/**
 * Store checkout. The browser cart is never trusted: every price, stock level, coupon and fee is re-read here.
 * Stock is taken with conditional updates inside one transaction (no overselling), and a retried checkout with the
 * same checkoutKey returns the same order. A placed order becomes a normal Vishwaship shipping order
 * (orders.source = "online_store") so booking, labels, pickup, tracking and COD remittance use the existing flows.
 */

const mobile = z.string().transform((s) => s.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "")).pipe(z.string().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit mobile number"));
export const CheckoutInput = z.object({
  checkoutKey: z.string().regex(/^[A-Za-z0-9_-]{12,64}$/),
  lines: z.array(z.object({ productId: z.string().max(60), variantId: z.string().max(60).nullable().default(null), qty: z.number().int().min(1).max(10) })).min(1, "Your cart is empty").max(30),
  buyer: z.object({
    name: z.string().trim().min(2, "Enter your full name").max(80),
    mobile,
    email: z.string().trim().max(120).email("Enter a valid email").or(z.literal("")).default(""),
    line1: z.string().trim().min(3, "Enter your address").max(200),
    line2: z.string().trim().max(200).default(""),
    pincode: z.string().regex(/^[1-9]\d{5}$/, "PIN code must be 6 digits"),
    city: z.string().trim().min(2, "Enter your city").max(60),
    state: z.string().trim().min(2, "Enter your state").max(60),
  }),
  paymentMethod: z.enum(["cod", "razorpay"]),
  coupon: z.string().trim().toUpperCase().max(30).default(""),
  attribution: z.record(z.string().max(40), z.string().max(300)).default({}),
});
export type CheckoutInput = z.infer<typeof CheckoutInput>;

export type Line = { productId: string; variantId: string | null; title: string; variantTitle: string | null; sku: string | null; qty: number; unitPaise: number; weightGrams: number; hsn: string | null; taxBps: number; image: string | null };
export type Quote = { lines: Line[]; subtotalPaise: number; discountPaise: number; shippingPaise: number; codFeePaise: number; totalPaise: number; coupon: { id: string; code: string } | null; codAllowed: boolean; codReason: string | null; onlineAllowed: boolean };
export class CheckoutError extends Error { constructor(message: string, public field?: string) { super(message); } }

type Store = typeof schema.stores.$inferSelect;
type Db = Awaited<ReturnType<typeof getDb>>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export async function liveStore(slug: string): Promise<Store> {
  const db = await getDb();
  const [s] = await db.select().from(schema.stores).where(eq(schema.stores.slug, slug));
  if (!s || s.status !== "live") throw new CheckoutError("This store is not taking orders right now");
  return s;
}

/** Price a cart from the database (used for the checkout summary and again when placing the order). */
export async function quoteCart(store: Store, lines: CheckoutInput["lines"], couponCode: string, method?: "cod" | "razorpay", q?: Db | Tx): Promise<Quote> {
  const db = q ?? (await getDb());
  const pids = [...new Set(lines.map((l) => l.productId))];
  const prods = await db.select().from(schema.storeProducts).where(and(eq(schema.storeProducts.storeId, store.id), inArray(schema.storeProducts.id, pids)));
  const vids = lines.map((l) => l.variantId).filter((v): v is string => !!v);
  const vars = vids.length ? await db.select().from(schema.storeProductVariants).where(and(eq(schema.storeProductVariants.storeId, store.id), inArray(schema.storeProductVariants.id, vids))) : [];
  const out: Line[] = [];
  for (const l of lines) {
    const p = prods.find((x) => x.id === l.productId);
    if (!p || p.status !== "active") throw new CheckoutError("A product in your cart is no longer available. Please remove it.");
    const hasVariants = (p.options as string[]).length > 0;
    let unit = p.pricePaise, stock = p.stock, weight = p.weightGrams, vTitle: string | null = null, sku = p.sku;
    if (hasVariants || l.variantId) {
      const v = vars.find((x) => x.id === l.variantId && x.productId === p.id && !x.archived);
      if (!v) throw new CheckoutError(`Choose an option for ${p.title}`);
      unit = v.pricePaise; stock = v.stock; weight = v.weightGrams ?? p.weightGrams; vTitle = v.title; sku = v.sku ?? p.sku;
    }
    const same = out.filter((o) => o.productId === p.id && o.variantId === (l.variantId ?? null)).reduce((n, o) => n + o.qty, 0);
    if (stock < l.qty + same) throw new CheckoutError(stock > 0 ? `Only ${stock} left of ${p.title}${vTitle ? ` (${vTitle})` : ""}` : `${p.title}${vTitle ? ` (${vTitle})` : ""} is out of stock`);
    out.push({ productId: p.id, variantId: l.variantId ?? null, title: p.title, variantTitle: vTitle, sku: sku ?? null, qty: l.qty, unitPaise: unit, weightGrams: weight, hsn: p.hsn, taxBps: p.taxBps, image: (p.images as string[])[0] ?? null });
  }
  const st = readSettings(store.settings).checkout;
  const subtotal = out.reduce((s, l) => s + l.unitPaise * l.qty, 0);
  let discount = 0, freeShip = false, coupon: Quote["coupon"] = null;
  if (couponCode) {
    const [c] = await db.select().from(schema.storeCoupons).where(and(eq(schema.storeCoupons.storeId, store.id), eq(schema.storeCoupons.code, couponCode)));
    const now = Date.now();
    if (!c || !c.active || (c.startsAt && c.startsAt.getTime() > now) || (c.endsAt && c.endsAt.getTime() < now) || (c.maxUses !== null && c.used >= c.maxUses))
      throw new CheckoutError("This coupon is not valid", "coupon");
    if (subtotal < c.minSubtotalPaise) throw new CheckoutError(`Add items worth ₹${((c.minSubtotalPaise - subtotal) / 100).toFixed(0)} more to use this coupon`, "coupon");
    if (c.kind === "percent") discount = Math.floor((subtotal * c.value) / 10_000);
    if (c.kind === "flat") discount = c.value;
    if (c.kind === "free_shipping") freeShip = true;
    if (c.maxDiscountPaise !== null) discount = Math.min(discount, c.maxDiscountPaise);
    discount = Math.min(discount, subtotal);
    coupon = { id: c.id, code: c.code };
  }
  const afterDiscount = subtotal - discount;
  const shipping = freeShip || (st.freeShippingAbovePaise > 0 && afterDiscount >= st.freeShippingAbovePaise) ? 0 : st.shippingFeePaise;
  const codTotal = afterDiscount + shipping + st.codFeePaise;
  let codReason: string | null = null;
  if (!st.codEnabled) codReason = "Cash on Delivery is not available";
  else if (st.codMinPaise > 0 && codTotal < st.codMinPaise) codReason = `Cash on Delivery is available on orders above ₹${(st.codMinPaise / 100).toFixed(0)}`;
  else if (st.codMaxPaise > 0 && codTotal > st.codMaxPaise) codReason = `Cash on Delivery is available on orders up to ₹${(st.codMaxPaise / 100).toFixed(0)}`;
  const codFee = method === "cod" ? st.codFeePaise : 0;
  return {
    lines: out, subtotalPaise: subtotal, discountPaise: discount, shippingPaise: shipping, codFeePaise: codFee, totalPaise: afterDiscount + shipping + codFee,
    // inside a transaction we must not open a second connection; placeOrder checks Razorpay before the transaction
    coupon, codAllowed: !codReason, codReason, onlineAllowed: q ? true : await razorpayReady(store.orgId),
  };
}

async function nextNumber(tx: Tx, store: Store) {
  const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.storeOrders).where(eq(schema.storeOrders.storeId, store.id));
  const prefix = store.slug.replace(/[^a-z0-9]/g, "").slice(0, 4).toUpperCase() || "WEB";
  return `${prefix}${1001 + n}`;
}

export type PlaceResult =
  | { kind: "placed"; orderId: string; number: string; token: string }
  | { kind: "pay"; orderId: string; number: string; token: string; razorpay: { keyId: string; orderId: string; amount: number; name: string; prefill: { name: string; contact: string; email: string } } };

/** Create the order (idempotent per checkoutKey). COD orders are placed at once; online orders wait for payment. */
export async function placeOrder(slug: string, input: CheckoutInput): Promise<PlaceResult> {
  const store = await liveStore(slug);
  const db = await getDb();
  const [existing] = await db.select().from(schema.storeOrders).where(and(eq(schema.storeOrders.storeId, store.id), eq(schema.storeOrders.checkoutKey, input.checkoutKey)));
  if (existing) return resume(store, existing);

  if (input.paymentMethod === "razorpay" && !(await razorpayReady(store.orgId))) throw new CheckoutError("Online payment is not available. Please choose Cash on Delivery.");
  const settings = readSettings(store.settings);
  if (!settings.checkout.warehouseId) throw new CheckoutError("This store is not taking orders right now");

  let created: typeof schema.storeOrders.$inferSelect;
  try {
    created = await db.transaction(async (tx) => {
      const q = await quoteCart(store, input.lines, input.coupon, input.paymentMethod, tx);
      if (input.paymentMethod === "cod" && !q.codAllowed) throw new CheckoutError(q.codReason ?? "Cash on Delivery is not available");
      // take stock: each update only succeeds if enough is left (concurrent checkouts can't oversell)
      for (const l of q.lines) {
        const res = l.variantId
          ? await tx.update(schema.storeProductVariants).set({ stock: sql`${schema.storeProductVariants.stock} - ${l.qty}` }).where(and(eq(schema.storeProductVariants.id, l.variantId), gte(schema.storeProductVariants.stock, l.qty))).returning({ id: schema.storeProductVariants.id })
          : await tx.update(schema.storeProducts).set({ stock: sql`${schema.storeProducts.stock} - ${l.qty}` }).where(and(eq(schema.storeProducts.id, l.productId), gte(schema.storeProducts.stock, l.qty))).returning({ id: schema.storeProducts.id });
        if (!res.length) throw new CheckoutError(`${l.title} just sold out. Please update your cart.`);
        // keep the product's total (shown in lists) in step with its variants
        if (l.variantId) await tx.update(schema.storeProducts).set({ stock: sql`greatest(${schema.storeProducts.stock} - ${l.qty}, 0)` }).where(eq(schema.storeProducts.id, l.productId));
      }
      if (q.coupon) {
        const ok = await tx.update(schema.storeCoupons).set({ used: sql`${schema.storeCoupons.used} + 1` })
          .where(and(eq(schema.storeCoupons.id, q.coupon.id), or(isNull(schema.storeCoupons.maxUses), lt(schema.storeCoupons.used, schema.storeCoupons.maxUses)))).returning({ id: schema.storeCoupons.id });
        if (!ok.length) throw new CheckoutError("This coupon has been fully used", "coupon");
      }
      const cod = input.paymentMethod === "cod";
      const [row] = await tx.insert(schema.storeOrders).values({
        id: newId("so"), storeId: store.id, orgId: store.orgId, number: await nextNumber(tx, store), checkoutKey: input.checkoutKey,
        buyerToken: randomToken(18), status: cod ? "placed" : "pending_payment", paymentMethod: input.paymentMethod, paymentStatus: cod ? "cod_pending" : "pending",
        buyer: { ...input.buyer }, lines: q.lines, subtotalPaise: q.subtotalPaise, discountPaise: q.discountPaise, shippingPaise: q.shippingPaise,
        codFeePaise: q.codFeePaise, totalPaise: q.totalPaise, couponCode: q.coupon?.code ?? null, attribution: input.attribution, placedAt: cod ? new Date() : null,
      }).returning();
      return row;
    });
  } catch (e) {
    // a concurrent retry with the same key won the race: return that order
    const [again] = await db.select().from(schema.storeOrders).where(and(eq(schema.storeOrders.storeId, store.id), eq(schema.storeOrders.checkoutKey, input.checkoutKey)));
    if (again) return resume(store, again);
    throw e;
  }
  return resume(store, created);
}

async function resume(store: Store, o: typeof schema.storeOrders.$inferSelect): Promise<PlaceResult> {
  if (o.status === "placed") { await ensureShippingOrder(o.id); await reportPurchase(o.id); return { kind: "placed", orderId: o.id, number: o.number, token: o.buyerToken }; }
  if (o.status === "cancelled") throw new CheckoutError("This order was cancelled. Please place a new order.");
  // pending online payment: create (once) the Razorpay order on the merchant's account
  let rzOrderId = o.razorpayOrderId, keyId = "";
  if (!rzOrderId) {
    const r = await createMerchantOrder(store.orgId, { amountPaise: o.totalPaise, receipt: o.number, notes: { store_order: o.id } });
    const db = await getDb();
    const upd = await db.update(schema.storeOrders).set({ razorpayOrderId: r.rzOrderId }).where(and(eq(schema.storeOrders.id, o.id), isNull(schema.storeOrders.razorpayOrderId))).returning({ id: schema.storeOrders.id });
    if (!upd.length) { const [x] = await db.select().from(schema.storeOrders).where(eq(schema.storeOrders.id, o.id)); rzOrderId = x.razorpayOrderId; }
    else rzOrderId = r.rzOrderId;
    keyId = r.keyId;
  } else {
    keyId = (await razorpayOverview(store.orgId))?.hints.keyId ?? "";
  }
  const b = o.buyer as CheckoutInput["buyer"];
  return { kind: "pay", orderId: o.id, number: o.number, token: o.buyerToken, razorpay: { keyId, orderId: rzOrderId!, amount: o.totalPaise, name: store.name, prefill: { name: b.name, contact: b.mobile, email: b.email } } };
}

/**
 * Mark an online order paid — exactly once, whichever arrives first (checkout callback, webhook, reconcile).
 * The payment is re-read from Razorpay and must be captured/authorized for the full order amount.
 */
export async function applyPayment(orgId: string, p: RzPayment, _source: "checkout" | "webhook" | "reconcile") {
  const db = await getDb();
  const [o] = await db.select().from(schema.storeOrders).where(and(eq(schema.storeOrders.orgId, orgId), eq(schema.storeOrders.razorpayOrderId, p.order_id)));
  if (!o) return { ok: false as const, message: "Order not found" };
  if (!["captured", "authorized"].includes(p.status) || p.amount !== o.totalPaise || p.currency !== "INR") return { ok: false as const, message: "Payment not completed" };
  if (o.status === "cancelled") {
    // paid after we gave up on it: keep the money visible so the merchant refunds it
    await db.update(schema.storeOrders).set({ paymentStatus: "refund_due", razorpayPaymentId: p.id, paidAt: new Date() }).where(and(eq(schema.storeOrders.id, o.id), isNull(schema.storeOrders.razorpayPaymentId)));
    return { ok: false as const, message: "Order was cancelled; the payment will be refunded" };
  }
  await db.update(schema.storeOrders).set({ status: "placed", paymentStatus: "paid", razorpayPaymentId: p.id, paidAt: new Date(), placedAt: new Date() })
    .where(and(eq(schema.storeOrders.id, o.id), eq(schema.storeOrders.status, "pending_payment")));
  await ensureShippingOrder(o.id);
  await reportPurchase(o.id);
  return { ok: true as const, orderId: o.id };
}

/** Browser callback after Razorpay checkout. */
export async function confirmCheckoutPayment(slug: string, a: { orderId: string; token: string; rzOrderId: string; paymentId: string; signature: string }) {
  const store = await liveStore(slug);
  const db = await getDb();
  const [o] = await db.select().from(schema.storeOrders).where(and(eq(schema.storeOrders.id, a.orderId), eq(schema.storeOrders.storeId, store.id)));
  if (!o || o.buyerToken !== a.token || o.razorpayOrderId !== a.rzOrderId) throw new CheckoutError("Order not found");
  if (o.status === "placed") return { ok: true as const };
  if (!(await verifyMerchantSignature(store.orgId, a.rzOrderId, a.paymentId, a.signature))) throw new CheckoutError("Payment could not be verified");
  const p = await fetchMerchantPayment(store.orgId, a.paymentId);
  const r = await applyPayment(store.orgId, p, "checkout");
  if (!r.ok) throw new CheckoutError(r.message);
  return { ok: true as const };
}

/** Create the linked Vishwaship shipping order once (idempotent via orders_store_ext). */
export async function ensureShippingOrder(storeOrderId: string) {
  const db = await getDb();
  const [o] = await db.select().from(schema.storeOrders).where(eq(schema.storeOrders.id, storeOrderId));
  if (!o || o.status !== "placed" || o.shippingOrderId) return o?.shippingOrderId ?? null;
  const [hit] = await db.select({ id: schema.orders.id }).from(schema.orders).where(and(eq(schema.orders.orgId, o.orgId), eq(schema.orders.externalStoreId, o.storeId), eq(schema.orders.externalOrderId, o.id)));
  let shippingId = hit?.id ?? null;
  if (!shippingId) {
    const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, o.storeId));
    const st = readSettings(store.settings).checkout;
    const lines = o.lines as Line[];
    const b = o.buyer as CheckoutInput["buyer"];
    const grams = Math.max(100, lines.reduce((s, l) => s + l.weightGrams * l.qty, 0));
    const pids = lines.map((l) => l.productId);
    const prods = await db.select({ l: schema.storeProducts.lengthMm, b: schema.storeProducts.breadthMm, h: schema.storeProducts.heightMm }).from(schema.storeProducts).where(inArray(schema.storeProducts.id, pids));
    const big = prods.reduce((m, p) => (p.l * p.b * p.h > m.l * m.b * m.h ? p : m), { l: 0, b: 0, h: 0 });
    const dims = big.l > 0 && big.b > 0 && big.h > 0 ? { lengthCm: big.l / 10, breadthCm: big.b / 10, heightCm: big.h / 10 } : { lengthCm: 20, breadthCm: 15, heightCm: 10 };
    const cod = o.paymentMethod === "cod";
    const input = {
      orderNumber: o.number, mode: "B2C" as const, direction: "forward" as const, paymentType: cod ? ("cod" as const) : ("prepaid" as const),
      codAmountRupees: cod ? o.totalPaise / 100 : 0, declaredValueRupees: o.totalPaise / 100, warehouseId: st.warehouseId ?? "",
      consignee: { name: b.name, mobile: b.mobile, email: b.email || undefined, line1: b.line1, line2: b.line2 || undefined, pincode: b.pincode, city: b.city, state: b.state },
      products: lines.map((l) => ({ name: (l.variantTitle ? `${l.title} (${l.variantTitle})` : l.title).slice(0, 120), sku: l.sku ?? undefined, qty: l.qty, unitPriceRupees: l.unitPaise / 100, hsn: l.hsn ?? undefined })),
      packages: [{ count: 1, ...dims, weightKg: grams / 1000 }],
    };
    let r = await createOrder(o.orgId, input, "online_store", { storeId: o.storeId, orderId: o.id });
    if (!r.ok && "duplicateOf" in r) r = await createOrder(o.orgId, { ...input, orderNumber: `${o.number}-S` }, "online_store", { storeId: o.storeId, orderId: o.id });
    if (!r.ok) { console.error("[store] shipping order failed", o.id, r.message); return null; }
    shippingId = r.orderId;
  }
  await db.update(schema.storeOrders).set({ shippingOrderId: shippingId }).where(and(eq(schema.storeOrders.id, o.id), isNull(schema.storeOrders.shippingOrderId)));
  return shippingId;
}

/** Give stock (and a coupon use) back exactly once. */
async function releaseStock(tx: Tx, o: typeof schema.storeOrders.$inferSelect) {
  const claimed = await tx.update(schema.storeOrders).set({ stockReleased: true }).where(and(eq(schema.storeOrders.id, o.id), eq(schema.storeOrders.stockReleased, false))).returning({ id: schema.storeOrders.id });
  if (!claimed.length) return;
  for (const l of o.lines as Line[]) {
    if (l.variantId) await tx.update(schema.storeProductVariants).set({ stock: sql`${schema.storeProductVariants.stock} + ${l.qty}` }).where(eq(schema.storeProductVariants.id, l.variantId));
    await tx.update(schema.storeProducts).set({ stock: sql`${schema.storeProducts.stock} + ${l.qty}` }).where(eq(schema.storeProducts.id, l.productId));
  }
  if (o.couponCode) await tx.update(schema.storeCoupons).set({ used: sql`greatest(${schema.storeCoupons.used} - 1, 0)` }).where(and(eq(schema.storeCoupons.storeId, o.storeId), eq(schema.storeCoupons.code, o.couponCode)));
}

/** Merchant cancels an order that has not been booked with a courier. Paid orders become "refund due". */
export async function cancelStoreOrder(orgId: string, id: string, reason: string) {
  const db = await getDb();
  const [o] = await db.select().from(schema.storeOrders).where(and(eq(schema.storeOrders.id, id), eq(schema.storeOrders.orgId, orgId)));
  if (!o) return { ok: false as const, message: "Order not found" };
  if (o.status === "cancelled") return { ok: true as const };
  if (o.shippingOrderId) {
    const done = await db.update(schema.orders).set({ status: "cancelled" })
      .where(and(eq(schema.orders.id, o.shippingOrderId), eq(schema.orders.orgId, orgId), inArray(schema.orders.status, ["draft", "ready", "cod_hold", "booking_failed", "cancelled"]))).returning({ id: schema.orders.id });
    if (!done.length) return { ok: false as const, message: "This order is already booked with a courier. Cancel the shipment from Orders first." };
  }
  await db.transaction(async (tx) => {
    await tx.update(schema.storeOrders).set({ status: "cancelled", cancelledAt: new Date(), note: reason.slice(0, 300) || null,
      paymentStatus: o.paymentStatus === "paid" ? "refund_due" : o.paymentStatus === "pending" ? "failed" : o.paymentStatus === "cod_pending" ? "cod_pending" : o.paymentStatus })
      .where(eq(schema.storeOrders.id, o.id));
    await releaseStock(tx, o);
  });
  return { ok: true as const };
}

export async function markRefunded(orgId: string, id: string) {
  const db = await getDb();
  const r = await db.update(schema.storeOrders).set({ paymentStatus: "refunded" }).where(and(eq(schema.storeOrders.id, id), eq(schema.storeOrders.orgId, orgId), eq(schema.storeOrders.paymentStatus, "refund_due"))).returning({ id: schema.storeOrders.id });
  return r.length ? { ok: true as const } : { ok: false as const, message: "Only orders marked refund due can be marked refunded" };
}

/**
 * Background sweep: unpaid online orders older than 30 min are re-checked with Razorpay (paid → placed, else
 * cancelled and stock released); orders whose shipping order was cancelled elsewhere (e.g. buyer said "cancel" to the
 * WhatsApp COD confirmation) are cancelled here too and their stock comes back.
 */
export async function sweepStoreOrders(now = new Date()) {
  const db = await getDb();
  const stale = await db.select().from(schema.storeOrders)
    .where(and(eq(schema.storeOrders.status, "pending_payment"), lt(schema.storeOrders.createdAt, new Date(now.getTime() - 30 * 60_000)))).limit(50);
  for (const o of stale) {
    let paid: RzPayment | undefined;
    if (o.razorpayOrderId) {
      try { paid = (await merchantOrderPayments(o.orgId, o.razorpayOrderId)).find((p) => ["captured", "authorized"].includes(p.status)); }
      catch { continue; } // Razorpay unreachable: try again next sweep, never cancel blindly
    }
    if (paid) { await applyPayment(o.orgId, paid, "reconcile"); continue; }
    await db.transaction(async (tx) => {
      const upd = await tx.update(schema.storeOrders).set({ status: "cancelled", paymentStatus: "failed", cancelledAt: now, note: "Payment not completed" })
        .where(and(eq(schema.storeOrders.id, o.id), eq(schema.storeOrders.status, "pending_payment"))).returning({ id: schema.storeOrders.id });
      if (upd.length) await releaseStock(tx, o);
    });
  }
  const orphaned = await db.select({ so: schema.storeOrders }).from(schema.storeOrders)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.storeOrders.shippingOrderId))
    .where(and(eq(schema.storeOrders.status, "placed"), eq(schema.orders.status, "cancelled"))).limit(50);
  for (const { so } of orphaned) {
    await db.transaction(async (tx) => {
      await tx.update(schema.storeOrders).set({ status: "cancelled", cancelledAt: now, note: so.note ?? "Shipping order cancelled",
        paymentStatus: so.paymentStatus === "paid" ? "refund_due" : so.paymentStatus }).where(eq(schema.storeOrders.id, so.id));
      await releaseStock(tx, so);
    });
  }
  return { stale: stale.length, orphaned: orphaned.length };
}

/** Queue server-side purchase events when the order's milestone is reached. Never blocks or fails a checkout. */
async function reportPurchase(storeOrderId: string) {
  try { const { queueConversions } = await import("./marketing"); await queueConversions(storeOrderId); }
  catch (e) { console.error("[store marketing]", (e as Error).message); }
}
