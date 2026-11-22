import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import { defaultTheme, readSettings } from "@/lib/store-themes";

// Real SQL on in-memory PGlite; Razorpay and Cashfree HTTP are faked; emails are captured.
const client = new PGlite();
const db = drizzle(client, { schema });
const mails: Array<{ to: string; vars: Record<string, string> }> = [];
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getDb: async () => db, schema }));
vi.mock("@/server/auth/session", () => ({ readSession: async () => null }));
vi.mock("@/server/email/service", () => ({ sendEmail: async (a: { to: string; vars: Record<string, string> }) => { mails.push(a); return { status: "sent" }; } }));

const rz = await import("./razorpay");
const gw = await import("./gateways");
const co = await import("./checkout");
const ops = await import("./ops");
const ord = await import("./orders");
const cat = await import("./catalog");
const stock = await import("./stock");
const refunds = await import("./refunds");

const A = "org_op_a", B = "org_op_b";
// Razorpay: refunds are accepted as "pending" and later "processed"; each receipt is created once
const rzRefunds = new Map<string, { id: string; status: string; receipt: string; payment: string }>();
let rzRefundCalls = 0;
const payments = new Map<string, { id: string; order_id: string; amount: number; currency: string; status: string }>();
let rzOrders = 0;
rz.__setRazorpayFetch(async (url, init) => {
  if (url.includes("/v1/orders?count=1")) return new Response("{}", { status: 200 });
  if (url.endsWith("/v1/orders") && init.method === "POST") return new Response(JSON.stringify({ id: `order_O${++rzOrders}` }), { status: 200 });
  const list = url.match(/\/v1\/payments\/([^/]+)\/refunds/);
  if (list) return new Response(JSON.stringify({ items: [...rzRefunds.values()].filter((r) => r.payment === decodeURIComponent(list[1])) }));
  const make = url.match(/\/v1\/payments\/([^/]+)\/refund$/);
  if (make) {
    rzRefundCalls++;
    const body = JSON.parse(String(init.body)) as { receipt: string; amount: number };
    const hit = [...rzRefunds.values()].find((r) => r.receipt === body.receipt);
    if (hit) return new Response(JSON.stringify(hit));
    const r = { id: `rfnd_${rzRefunds.size + 1}`, status: "pending", receipt: body.receipt, payment: decodeURIComponent(make[1]) };
    rzRefunds.set(r.id, r);
    return new Response(JSON.stringify(r));
  }
  const pay = url.match(/\/v1\/payments\/([^/]+)$/);
  if (pay) { const p = payments.get(decodeURIComponent(pay[1])); return p ? new Response(JSON.stringify(p)) : new Response("{}", { status: 404 }); }
  const op = url.match(/\/v1\/orders\/([^/]+)\/payments$/);
  if (op) return new Response(JSON.stringify({ items: [...payments.values()].filter((p) => p.order_id === decodeURIComponent(op[1])) }));
  return new Response("{}", { status: 404 });
});
// Cashfree: the order is paid; refunds are refused (so the merchant must refund by hand)
gw.__setGatewayFetch(async (url, init) => {
  if (/\/pg\/orders\/vsconn/.test(url)) return new Response("{}", { status: 404 });
  if (url.endsWith("/pg/orders") && init.method === "POST") return new Response(JSON.stringify({ payment_session_id: "sess_1" }));
  if (/\/refunds\/[^/]+$/.test(url)) return new Response(JSON.stringify({ message: "refund not found" }), { status: 404 });
  if (/\/refunds$/.test(url)) return new Response(JSON.stringify({ message: "Refunds are not enabled on this account" }), { status: 400 });
  const m = url.match(/\/pg\/orders\/([^/]+)$/);
  if (m) return new Response(JSON.stringify({ order_status: "PAID", order_amount: 500, cf_order_id: 77 }));
  return new Response("{}", { status: 404 });
});

const buyer = { name: "Asha", mobile: "9876500001", email: "asha@example.test", line1: "1 Park St", line2: "", pincode: "700016", city: "Kolkata", state: "WB" };
let pid = "", lastId = "", varProd = "", varS = "";
const key = (s: string) => `ck_op_${s}_0123456789`;
const input = (k: string, lines: Array<{ productId: string; variantId?: string | null; qty: number }>, paymentMethod: "cod" | "razorpay" | "cashfree" = "cod") =>
  co.CheckoutInput.parse({ checkoutKey: key(k), lines: lines.map((l) => ({ variantId: null, ...l })), buyer, paymentMethod, coupon: "" });
const prod = async (id: string) => (await db.select().from(schema.storeProducts).where(eq(schema.storeProducts.id, id)))[0];
const row = async (id: string) => (await db.select().from(schema.storeOrders).where(eq(schema.storeOrders.id, id)))[0];
const placed = async (k: string, lines: Parameters<typeof input>[1], m: Parameters<typeof input>[2] = "cod") => {
  const r = await co.placeOrder("op-store", input(k, lines, m));
  return r.orderId;
};

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./migrations" });
  for (const o of [A, B]) await db.insert(schema.orgs).values({ id: o, name: o, businessName: o });
  await db.insert(schema.users).values({ id: "u_op", kind: "customer", orgId: A, name: "Merchant", email: "m@op.test", mobile: "9000000001" });
  await db.insert(schema.warehouses).values({ id: "wh_op", orgId: A, label: "Main", contactName: "A", mobile: "9999999999", line1: "x", pincode: "700001", city: "Kolkata", state: "WB" });
  const settings = readSettings({ checkout: { codEnabled: true, shippingFeePaise: 0, warehouseId: "wh_op", codMaxPaise: 0 } });
  await db.insert(schema.stores).values({ id: "st_op", orgId: A, name: "Op Store", slug: "op-store", status: "live", draftTheme: defaultTheme(), publishedTheme: defaultTheme(), settings });
  pid = (await cat.saveProduct(A, cat.ProductInput.parse({ title: "Brass Tap", priceRupees: 500, stock: 5, weightGrams: 500, status: "active" }))).id;
  await db.update(schema.storeProducts).set({ unitCostPaise: 20_000 }).where(eq(schema.storeProducts.id, pid));
  lastId = (await cat.saveProduct(A, cat.ProductInput.parse({ title: "Last Unit Shower", priceRupees: 900, stock: 1, weightGrams: 500, status: "active" }))).id;
  varProd = (await cat.saveProduct(A, cat.ProductInput.parse({ title: "Towel Rod", priceRupees: 700, stock: 0, weightGrams: 500, status: "active", options: ["Size"],
    variants: [{ values: ["S"], priceRupees: 700, stock: 4 }, { values: ["L"], priceRupees: 800, stock: 4 }] }))).id;
  varS = (await cat.productVariants(A, varProd)).find((v) => v.title === "S")!.id;
  await rz.saveRazorpayKeys(A, "u_op", { keyId: "rzp_test_OPSTOREKEY1", keySecret: "rzp_secret_for_tests_123", webhookSecret: "" });
  await gw.saveGatewayKeys(A, "u_op", "cashfree", "test", { appId: "CF_APP_123", secretKey: "cf_secret_key_123456" });
});

describe("acceptance", () => {
  it("a new order waits for acceptance with its stock held; no shipping order yet", async () => {
    const id = await placed("a1", [{ productId: pid, qty: 2 }]);
    const o = await row(id);
    expect(o).toMatchObject({ status: "placed", acceptance: "pending", stockState: "reserved", shippingOrderId: null });
    expect(await prod(pid)).toMatchObject({ stock: 3, reserved: 2 });
    const moves = await db.select().from(schema.storeStockMoves).where(eq(schema.storeStockMoves.storeOrderId, id));
    expect(moves).toMatchObject([{ kind: "order_reserved", available: -2, reserved: 2 }]);
    expect((await ord.listStoreOrders(A, { tab: "pending" })).map((x) => x.id)).toContain(id);
    expect((await ord.tabCounts(A)).pending).toBe(1);
    expect(await ops.pendingAcceptanceCount(A)).toBe(1);
  });

  it("accept prepares the shipment once; accepting again or at the same time adds nothing", async () => {
    const [o] = await ord.listStoreOrders(A, { tab: "pending" });
    const both = await Promise.all([ops.acceptOrders(A, "u_op", [o.id]), ops.acceptOrders(A, "u_op", [o.id])]);
    expect(both.flat().every((r) => r.ok)).toBe(true);
    const r = await row(o.id);
    expect(r).toMatchObject({ acceptance: "accepted", acceptedBy: "u_op" });
    expect(r.shippingOrderId).toBeTruthy();
    expect(await db.select().from(schema.orders).where(eq(schema.orders.externalOrderId, o.id))).toHaveLength(1);
    expect((await ord.storeOrderForOrg(A, o.id))?.stage).toBe("to_pack");
    expect((await ops.orderTimeline(A, o.id)).map((e) => e.kind)).toEqual(["placed", "accepted"]);
    // another org can neither see nor accept it
    expect(await ops.acceptOrders(B, "u_x", [o.id])).toMatchObject([{ ok: false, message: "Order not found" }]);
  });

  it("bulk accept reports every order on its own", async () => {
    const p1 = await placed("b1", [{ productId: varProd, variantId: varS, qty: 1 }]);
    const done = (await ord.listStoreOrders(A, { tab: "to_pack" }))[0].id;
    const res = await ops.acceptOrders(A, "u_op", [p1, done, "so_nope"]);
    expect(res.map((r) => [r.ok, r.message])).toEqual([[true, "Accepted"], [true, "Already accepted"], [false, "Order not found"]]);
    // a variant order keeps the product's totals in step
    const v = (await cat.productVariants(A, varProd)).find((x) => x.id === varS)!;
    expect(v).toMatchObject({ stock: 3, reserved: 1 });
    expect(await prod(varProd)).toMatchObject({ reserved: 1 });
  });

  it("reject needs a reason, gives stock back once and tells the buyer", async () => {
    const id = await placed("r1", [{ productId: pid, qty: 1 }]);
    expect(await prod(pid)).toMatchObject({ stock: 2, reserved: 3 });
    expect((await ops.rejectOrders(A, "u_op", [id], " ")))
      .toMatchObject([{ ok: false, message: "Give a reason for rejecting" }]);
    expect(await ops.rejectOrders(A, "u_op", [id], "Out of stock")).toMatchObject([{ ok: true, message: "Rejected" }]);
    expect(await ops.rejectOrders(A, "u_op", [id], "Out of stock")).toMatchObject([{ ok: true, message: "Already rejected" }]);
    expect(await row(id)).toMatchObject({ status: "cancelled", acceptance: "rejected", rejectReason: "Out of stock", stockState: "released" });
    expect(await prod(pid)).toMatchObject({ stock: 3, reserved: 2 });
    expect((await ord.storeOrderForOrg(A, id))?.stage).toBe("rejected");
    const num = (await row(id)).number;
    expect(mails.find((m) => m.vars.order_id === num)).toMatchObject({ to: "asha@example.test", vars: { reason: "Out of stock", refund_line: "You have not been charged." } });
    // accepted orders cannot be "rejected" (they are cancelled instead)
    const acc = (await ord.listStoreOrders(A, { tab: "to_pack" }))[0].id;
    expect((await ops.rejectOrders(A, "u_op", [acc], "x y z"))[0].ok).toBe(false);
  });

  it("auto-accept stores skip the queue", async () => {
    const [s] = await db.select().from(schema.stores).where(eq(schema.stores.id, "st_op"));
    const set = readSettings(s.settings);
    await db.update(schema.stores).set({ settings: { ...set, checkout: { ...set.checkout, autoAccept: true } } }).where(eq(schema.stores.id, "st_op"));
    const id = await placed("auto1", [{ productId: pid, qty: 1 }]);
    expect(await row(id)).toMatchObject({ acceptance: "accepted" });
    expect((await row(id)).shippingOrderId).toBeTruthy();
    expect((await ops.orderTimeline(A, id)).at(-1)?.message).toMatch(/automatically/);
    await db.update(schema.stores).set({ settings: { ...set, checkout: { ...set.checkout, autoAccept: false } } }).where(eq(schema.stores.id, "st_op"));
  });
});

describe("stock", () => {
  it("two buyers going for the last unit: exactly one gets it", async () => {
    // PGlite has one connection, so the race is played in turn; the guard is the same conditional update either way
    await placed("race1", [{ productId: lastId, qty: 1 }]);
    await expect(placed("race2", [{ productId: lastId, qty: 1 }])).rejects.toThrow(/out of stock|sold out/);
    await db.transaction(async (tx) => {
      expect(await stock.reserveLine(tx, { id: "so_x", storeId: "st_op", orgId: A }, { productId: lastId, variantId: null, qty: 1, title: "Last Unit Shower" })).toBe(false);
    });
    expect(await prod(lastId)).toMatchObject({ stock: 0, reserved: 1 });
  });

  it("goods leaving the warehouse are deducted once, with their unit cost; a later cancel gives nothing back", async () => {
    const [o] = (await ord.listStoreOrders(A, { tab: "to_pack" })).filter((x) => x.lines[0].productId === pid && x.lines[0].qty === 2);
    const before = await prod(pid);
    await db.update(schema.orders).set({ status: "booked" }).where(eq(schema.orders.id, o.shippingOrderId!));
    await db.insert(schema.shipments).values({ id: "shp_op1", orgId: A, orderId: o.shippingOrderId!, providerAccountId: "pa", provider: "demo", carrierCode: "demo", carrierName: "Demo",
      serviceName: "Surface", awb: "AWBOP1", bookingStatus: "confirmed", status: "booked", quoteId: "q", sellPaise: 5000, costPaise: 4000, chargeableWeightGrams: 500 });
    expect(await stock.sweepDispatched()).toBe(0); // booked but not picked up: still held
    expect((await ord.storeOrderForOrg(A, o.id))?.stage).toBe("ready_to_ship");
    await db.update(schema.shipments).set({ status: "picked_up" }).where(eq(schema.shipments.id, "shp_op1"));
    expect(await stock.sweepDispatched()).toBe(1);
    expect(await stock.sweepDispatched()).toBe(0);
    expect(await prod(pid)).toMatchObject({ stock: before.stock, reserved: before.reserved - 2 });
    expect(await row(o.id)).toMatchObject({ stockState: "deducted", costs: [{ productId: pid, qty: 2, unitCostPaise: 20_000 }] });
    expect((await ord.storeOrderForOrg(A, o.id))?.stage).toBe("picked_up");
    // a cancelled shipping order later on must not put shipped goods back on sale
    const shipped = await row(o.id);
    await db.transaction(async (tx) => { expect(await stock.releaseOrderStock(tx, shipped)).toBe(false); });
    expect((await prod(pid)).stock).toBe(before.stock);
  });

  it("orders from before reservations give stock back without touching held counts", async () => {
    const id = await placed("leg1", [{ productId: pid, qty: 1 }]);
    await db.update(schema.storeOrders).set({ stockState: "legacy" }).where(eq(schema.storeOrders.id, id));
    await db.update(schema.storeProducts).set({ reserved: sql0(await prod(pid)) }).where(eq(schema.storeProducts.id, pid));
    const p0 = await prod(pid);
    await ops.rejectOrders(A, "u_op", [id], "Old order");
    expect(await prod(pid)).toMatchObject({ stock: p0.stock + 1, reserved: p0.reserved });
  });
});

/** the order above held 1 unit; pretend it never did (as orders from before this feature) */
function sql0(p: { reserved: number }) { return p.reserved - 1; }

describe("refunds", () => {
  it("rejecting a paid Razorpay order refunds it once; the sweep follows it to processed", async () => {
    const r = await co.placeOrder("op-store", input("rzp1", [{ productId: pid, qty: 1 }], "razorpay"));
    if (r.kind !== "pay") throw new Error("expected pay");
    payments.set("pay_op1", { id: "pay_op1", order_id: r.razorpay.orderId, amount: r.razorpay.amount, currency: "INR", status: "captured" });
    await co.applyPayment(A, payments.get("pay_op1")!, "webhook");
    expect(await row(r.orderId)).toMatchObject({ status: "placed", paymentStatus: "paid", acceptance: "pending" });
    const [res] = await ops.rejectOrders(A, "u_op", [r.orderId], "Out of stock");
    expect(res).toMatchObject({ ok: true, refund: "pending" });
    expect(await row(r.orderId)).toMatchObject({ paymentStatus: "refund_pending" });
    expect(rzRefundCalls).toBe(1);
    // a second try never creates a second refund
    await refunds.startRefund(r.orderId);
    expect(rzRefundCalls).toBe(1);
    for (const x of rzRefunds.values()) x.status = "processed";
    await refunds.sweepRefunds();
    expect(await row(r.orderId)).toMatchObject({ paymentStatus: "refunded", refund: { status: "processed", gatewayRefundId: "rfnd_1" } });
    expect((await ops.orderTimeline(A, r.orderId)).map((e) => e.kind)).toEqual(expect.arrayContaining(["paid", "rejected", "refund_started", "refund_pending", "refund_done"]));
    expect(mails.at(-1)?.vars.refund_line).toMatch(/refunded/);
  });

  it("a gateway that refuses the refund leaves the order refund-due for a manual refund", async () => {
    const r = await co.placeOrder("op-store", input("cf1", [{ productId: pid, qty: 1 }], "cashfree"));
    if (r.kind !== "gateway") throw new Error("expected gateway");
    const o = await row(r.orderId);
    await co.applyGatewayPayment(o, { state: "paid", amountPaise: o.totalPaise, paymentId: "cf_77" });
    const [res] = await ops.rejectOrders(A, "u_op", [r.orderId], "Address not serviceable");
    expect(res.refund).toBe("failed");
    expect(await row(r.orderId)).toMatchObject({ paymentStatus: "refund_due", refund: { status: "failed", message: "Refunds are not enabled on this account" } });
    expect((await co.markRefunded(A, r.orderId)).ok).toBe(true);
    expect((await row(r.orderId)).paymentStatus).toBe("refunded");
  });

  it("failed payment attempts are listed apart from real orders", async () => {
    await co.placeOrder("op-store", input("unpaid1", [{ productId: pid, qty: 1 }], "razorpay"));
    await co.sweepStoreOrders(new Date(Date.now() + 31 * 60_000));
    const unpaid = await ord.listStoreOrders(A, { tab: "unpaid" });
    expect(unpaid.some((x) => x.stage === "payment_failed")).toBe(true);
    expect((await ord.listStoreOrders(A, { tab: "cancelled" })).some((x) => x.stage === "payment_failed")).toBe(false);
    const [st] = await db.select().from(schema.storeOrders).where(and(eq(schema.storeOrders.orgId, A), eq(schema.storeOrders.checkoutKey, key("unpaid1"))));
    expect(st.stockState).toBe("released");
  });
});
