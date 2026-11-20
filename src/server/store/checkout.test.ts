import { beforeAll, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import { defaultTheme, readSettings } from "@/lib/store-themes";

// Real SQL on in-memory PGlite; Razorpay HTTP is faked.
const client = new PGlite();
const db = drizzle(client, { schema });
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getDb: async () => db, schema }));
vi.mock("@/server/auth/session", () => ({ readSession: async () => null }));

const rz = await import("./razorpay");
const co = await import("./checkout");
const ord = await import("./orders");
const cat = await import("./catalog");
const io = await import("./catalog-io");

const A = "org_co_a", B = "org_co_b";
const SECRET = "rzp_secret_for_tests_123";
const WEBHOOK = "whsec_for_tests_456";
const payments = new Map<string, { id: string; order_id: string; amount: number; currency: string; status: string }>();
let rzOrders = 0;
rz.__setRazorpayFetch(async (url, init) => {
  if (url.includes("/v1/orders?count=1")) return new Response("{}", { status: 200 });
  if (url.endsWith("/v1/orders") && init.method === "POST") return new Response(JSON.stringify({ id: `order_T${++rzOrders}` }), { status: 200 });
  const pay = url.match(/\/v1\/payments\/([^/]+)$/);
  if (pay) { const p = payments.get(decodeURIComponent(pay[1])); return p ? new Response(JSON.stringify(p)) : new Response("{}", { status: 404 }); }
  const op = url.match(/\/v1\/orders\/([^/]+)\/payments$/);
  if (op) return new Response(JSON.stringify({ items: [...payments.values()].filter((p) => p.order_id === decodeURIComponent(op[1])) }));
  return new Response("{}", { status: 404 });
});

const buyer = { name: "Ravi Kumar", mobile: "9876543210", email: "", line1: "12 MG Road", line2: "", pincode: "110001", city: "New Delhi", state: "Delhi" };
let simpleId = "", varProdId = "", varM = "", varL = "";
const key = (s: string) => `ck_${s}_0123456789`;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./migrations" });
  for (const o of [A, B]) await db.insert(schema.orgs).values({ id: o, name: o, businessName: o });
  await db.insert(schema.warehouses).values({ id: "wh_co", orgId: A, label: "Main", contactName: "A", mobile: "9999999999", line1: "x", pincode: "110034", city: "Delhi", state: "Delhi" });
  const settings = readSettings({ checkout: { codEnabled: true, codFeePaise: 4000, codMinPaise: 0, codMaxPaise: 300000, shippingFeePaise: 5000, freeShippingAbovePaise: 200000, warehouseId: "wh_co" } });
  await db.insert(schema.stores).values({ id: "st_co", orgId: A, name: "Co Store", slug: "co-store", status: "live", draftTheme: defaultTheme(), publishedTheme: defaultTheme(), settings });
  await db.insert(schema.stores).values({ id: "st_cob", orgId: B, name: "Other", slug: "other-store", status: "live", draftTheme: defaultTheme(), publishedTheme: defaultTheme(), settings: readSettings({}) });
  simpleId = (await cat.saveProduct(A, cat.ProductInput.parse({ title: "Brass Diya", priceRupees: 500, stock: 2, weightGrams: 300, status: "active" }))).id;
  varProdId = (await cat.saveProduct(A, cat.ProductInput.parse({ title: "Kurta", priceRupees: 1000, stock: 0, weightGrams: 400, status: "active", options: ["Size"],
    variants: [{ values: ["M"], priceRupees: 1000, stock: 1 }, { values: ["L"], priceRupees: 1200, stock: 3 }] }))).id;
  const vs = await cat.productVariants(A, varProdId);
  varM = vs.find((v) => v.title === "M")!.id; varL = vs.find((v) => v.title === "L")!.id;
  await io.saveCoupon(A, io.CouponInput.parse({ code: "TEN", kind: "percent", value: 10, maxUses: 1 }));
});

const input = (k: string, lines: Array<{ productId: string; variantId?: string | null; qty: number }>, paymentMethod: "cod" | "razorpay" = "cod", coupon = "") =>
  co.CheckoutInput.parse({ checkoutKey: key(k), lines: lines.map((l) => ({ variantId: null, ...l })), buyer, paymentMethod, coupon });

describe("pricing is always server-side", () => {
  it("re-prices from the database, applies coupon, shipping and COD fee, enforces COD limits", async () => {
    const store = await co.liveStore("co-store");
    const q = await co.quoteCart(store, [{ productId: simpleId, variantId: null, qty: 2 }], "TEN", "cod");
    expect(q.subtotalPaise).toBe(100000);
    expect(q.discountPaise).toBe(10000);
    expect(q.shippingPaise).toBe(5000);
    expect(q.codFeePaise).toBe(4000);
    expect(q.totalPaise).toBe(99000);
    await expect(co.quoteCart(store, [{ productId: simpleId, variantId: null, qty: 3 }], "", "cod")).rejects.toThrow(/Only 2 left/);
    await expect(co.quoteCart(store, [{ productId: varProdId, variantId: null, qty: 1 }], "", "cod")).rejects.toThrow(/Choose an option/);
    await expect(co.quoteCart(store, [{ productId: simpleId, variantId: null, qty: 1 }], "NOPE")).rejects.toThrow(/not valid/);
    const big = await co.quoteCart(store, [{ productId: varProdId, variantId: varL, qty: 3 }], "");
    expect(big.shippingPaise).toBe(0); // ₹3,600 is above the ₹2,000 free-shipping line
  });
});

describe("placing orders", () => {
  it("COD: places once per checkout key, takes stock, creates one shipping order", async () => {
    const r1 = await co.placeOrder("co-store", input("cod1", [{ productId: simpleId, qty: 1 }]));
    const r2 = await co.placeOrder("co-store", input("cod1", [{ productId: simpleId, qty: 1 }]));
    expect(r1.kind).toBe("placed");
    expect(r2.orderId).toBe(r1.orderId);
    const [p] = await db.select().from(schema.storeProducts).where(eq(schema.storeProducts.id, simpleId));
    expect(p.stock).toBe(1);
    const ship = await db.select().from(schema.orders).where(and(eq(schema.orders.orgId, A), eq(schema.orders.source, "online_store")));
    expect(ship).toHaveLength(1);
    expect(ship[0].paymentType).toBe("cod");
    expect(ship[0].codAmountPaise).toBe(500 * 100 + 5000 + 4000);
    await co.ensureShippingOrder(r1.orderId);
    expect(await db.select().from(schema.orders).where(eq(schema.orders.source, "online_store"))).toHaveLength(1);
  });

  it("never oversells: the last unit goes to one buyer only", async () => {
    const [a, b] = await Promise.allSettled([
      co.placeOrder("co-store", input("race1", [{ productId: varProdId, variantId: varM, qty: 1 }])),
      co.placeOrder("co-store", input("race2", [{ productId: varProdId, variantId: varM, qty: 1 }])),
    ]);
    expect([a.status, b.status].sort()).toEqual(["fulfilled", "rejected"]);
    const [v] = await db.select().from(schema.storeProductVariants).where(eq(schema.storeProductVariants.id, varM));
    expect(v.stock).toBe(0);
  });

  it("online: needs a verified Razorpay, checks the signature, and marks paid exactly once", async () => {
    await expect(co.placeOrder("co-store", input("rz0", [{ productId: varProdId, variantId: varL, qty: 1 }], "razorpay"))).rejects.toThrow(/not available/);
    expect((await rz.saveRazorpayKeys(A, "u1", { keyId: "rzp_test_ABCDEFGH12", keySecret: SECRET, webhookSecret: WEBHOOK })).ok).toBe(true);
    const ov = await rz.razorpayOverview(A);
    expect(JSON.stringify(ov)).not.toContain(SECRET);
    const r = await co.placeOrder("co-store", input("rz1", [{ productId: varProdId, variantId: varL, qty: 1 }], "razorpay", "TEN"));
    expect(r.kind).toBe("pay");
    if (r.kind !== "pay") return;
    expect(r.razorpay.amount).toBe(120000 - 12000 + 5000);
    const sig = (pid: string) => createHmac("sha256", SECRET).update(`${r.razorpay.orderId}|${pid}`).digest("hex");
    payments.set("pay_1", { id: "pay_1", order_id: r.razorpay.orderId, amount: r.razorpay.amount, currency: "INR", status: "captured" });
    await expect(co.confirmCheckoutPayment("co-store", { orderId: r.orderId, token: r.token, rzOrderId: r.razorpay.orderId, paymentId: "pay_1", signature: "bad" })).rejects.toThrow(/verified/);
    await expect(co.confirmCheckoutPayment("co-store", { orderId: r.orderId, token: "wrong", rzOrderId: r.razorpay.orderId, paymentId: "pay_1", signature: sig("pay_1") })).rejects.toThrow(/not found/);
    await co.confirmCheckoutPayment("co-store", { orderId: r.orderId, token: r.token, rzOrderId: r.razorpay.orderId, paymentId: "pay_1", signature: sig("pay_1") });
    // webhook arrives too: still one order, one shipment
    await co.applyPayment(A, payments.get("pay_1")!, "webhook");
    const o = await ord.storeOrderForOrg(A, r.orderId);
    expect(o).toMatchObject({ status: "placed", paymentStatus: "paid", fulfilment: "unfulfilled", couponCode: "TEN" });
    const ships = await db.select().from(schema.orders).where(and(eq(schema.orders.externalOrderId, r.orderId)));
    expect(ships).toHaveLength(1);
    expect(ships[0].paymentType).toBe("prepaid");
    // coupon had maxUses 1
    await expect(co.placeOrder("co-store", input("rz2", [{ productId: varProdId, variantId: varL, qty: 1 }], "cod", "TEN"))).rejects.toThrow(/not valid|fully used/);
    // webhook signature helper
    const body = JSON.stringify({ event: "payment.captured" });
    expect(await rz.verifyMerchantWebhook(A, body, createHmac("sha256", WEBHOOK).update(body).digest("hex"))).toBe(true);
    expect(await rz.verifyMerchantWebhook(A, body, "nope")).toBe(false);
    expect(await rz.orgByWebhookKey(ov!.webhookUrl.split("/").filter(Boolean).pop()!)).toBe(A);
  });

  it("an underpaid payment does not place the order", async () => {
    const r = await co.placeOrder("co-store", input("rz3", [{ productId: varProdId, variantId: varL, qty: 1 }], "razorpay"));
    if (r.kind !== "pay") throw new Error("expected pay");
    const res = await co.applyPayment(A, { id: "pay_low", order_id: r.razorpay.orderId, amount: 100, currency: "INR", status: "captured" }, "webhook");
    expect(res.ok).toBe(false);
    expect((await ord.storeOrderForOrg(A, r.orderId))?.status).toBe("pending_payment");
  });
});

describe("sweep, cancel, refund, isolation", () => {
  it("unpaid orders expire after 30 min and give stock back; paid ones are reconciled", async () => {
    const [before] = await db.select().from(schema.storeProductVariants).where(eq(schema.storeProductVariants.id, varL));
    const later = new Date(Date.now() + 31 * 60_000);
    const pending = await db.select().from(schema.storeOrders).where(eq(schema.storeOrders.status, "pending_payment"));
    expect(pending.length).toBe(1);
    // the buyer actually paid this one — reconcile must place it, not cancel it
    payments.set("pay_2", { id: "pay_2", order_id: pending[0].razorpayOrderId!, amount: pending[0].totalPaise, currency: "INR", status: "captured" });
    await co.sweepStoreOrders(later);
    expect((await ord.storeOrderForOrg(A, pending[0].id))?.paymentStatus).toBe("paid");
    // a new unpaid one is cancelled and stock returns
    const r = await co.placeOrder("co-store", input("rz4", [{ productId: varProdId, variantId: varL, qty: 1 }], "razorpay"));
    await co.sweepStoreOrders(new Date(Date.now() + 31 * 60_000));
    expect((await ord.storeOrderForOrg(A, r.orderId))?.status).toBe("cancelled");
    const [after] = await db.select().from(schema.storeProductVariants).where(eq(schema.storeProductVariants.id, varL));
    expect(after.stock).toBe(before.stock); // pay_2's unit (already taken) stays sold; rz4's unit came back
  });

  it("merchant cancel returns stock once; paid → refund due → refunded; other orgs can't touch it", async () => {
    const paid = (await ord.listStoreOrders(A, { payment: "paid" }))[0];
    expect((await co.cancelStoreOrder(B, paid.id, "x")).ok).toBe(false);
    expect(await ord.storeOrderForOrg(B, paid.id)).toBeNull();
    const [v0] = await db.select().from(schema.storeProductVariants).where(eq(schema.storeProductVariants.id, varL));
    expect((await co.cancelStoreOrder(A, paid.id, "Out of stock")).ok).toBe(true);
    expect((await co.cancelStoreOrder(A, paid.id, "again")).ok).toBe(true);
    const [v1] = await db.select().from(schema.storeProductVariants).where(eq(schema.storeProductVariants.id, varL));
    expect(v1.stock).toBe(v0.stock + 1);
    expect((await ord.storeOrderForOrg(A, paid.id))?.paymentStatus).toBe("refund_due");
    expect((await co.markRefunded(A, paid.id)).ok).toBe(true);
    expect((await ord.storeOrderForOrg(A, paid.id))?.paymentStatus).toBe("refunded");
    // booked shipment: cancel must go through the shipment first
    const cod = (await ord.listStoreOrders(A, { method: "cod" })).find((o) => o.status === "placed")!;
    await db.update(schema.orders).set({ status: "booked" }).where(eq(schema.orders.id, cod.shippingOrderId!));
    expect((await co.cancelStoreOrder(A, cod.id, "x")).ok).toBe(false);
  });

  it("buyer lookups need the token or the matching mobile", async () => {
    const o = (await ord.listStoreOrders(A, {}))[0];
    const [row] = await db.select().from(schema.storeOrders).where(eq(schema.storeOrders.id, o.id));
    expect(await ord.buyerOrder("st_co", o.number, "wrong")).toBeNull();
    expect((await ord.buyerOrder("st_co", o.number, row.buyerToken))?.id).toBe(o.id);
    expect(await ord.buyerOrderByMobile("st_co", o.number, "9000000000")).toBeNull();
    expect((await ord.buyerOrderByMobile("st_co", o.number, "+91 98765 43210"))?.id).toBe(o.id);
    expect(await ord.buyerOrderByMobile("st_cob", o.number, "9876543210")).toBeNull();
  });
});

describe("CSV import", () => {
  it("previews row errors and imports only valid products, grouping variants by handle", async () => {
    const csv = [
      "handle,title,price,stock,weight_grams,option1_name,option1_value,category",
      "tee,Cotton Tee,499,5,200,Size,S,Tops",
      "tee,Cotton Tee,499,7,210,Size,M,Tops",
      "mug,Clay Mug,abc,3,300,,,",
      "pot,Clay Pot,299,4,800,,,Home",
    ].join("\n");
    const { preview } = await io.planImport(A, csv);
    expect(preview.products).toBe(3);
    expect(preview.valid).toBe(2);
    expect(preview.rows.find((r) => r.row === 4)?.errors.join(" ")).toMatch(/price/i);
    const r = await io.runImport(A, csv);
    expect(r).toEqual({ created: 2, updated: 0, skipped: 1 });
    const tee = (await cat.listProducts(A, { q: "tee" }))[0];
    expect(tee.options).toEqual(["Size"]);
    expect((await cat.productVariants(A, tee.id)).map((v) => v.stock)).toEqual([5, 7]);
    expect((await io.runImport(A, csv)).updated).toBe(2);
    expect((await io.exportProductsCsv(A)).split("\r\n")[0]).toContain("handle,title");
  });
});
