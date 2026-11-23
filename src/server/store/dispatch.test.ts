import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import { PDFDocument } from "pdf-lib";
import * as schema from "@/server/db/schema";
import { defaultTheme, readSettings } from "@/lib/store-themes";

// Real SQL on in-memory PGlite. Courier choice and booking are faked: booking writes one shipment per call, like the
// real flow, and can be told to fail for a pincode.
const client = new PGlite();
const db = drizzle(client, { schema });
const booked: string[] = [];
const failPins = new Set<string>();
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getDb: async () => db, schema }));
vi.mock("@/server/auth/session", () => ({ readSession: async () => null }));
vi.mock("@/server/email/service", () => ({ sendEmail: async () => ({ status: "sent" }) }));
// two couriers: Delhivery Surface ₹60 everywhere, Xpressbees Air ₹50 only outside PIN 171xxx
const choices: string[] = [];
const offersFor = async (orderId: string) => {
  const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
  const pin = (o.consignee as { pincode: string }).pincode;
  if (failPins.has(pin)) return [];
  return [{ quoteId: "q1", carrierName: "Delhivery", carrierCode: "delhivery", serviceName: "Surface", total: 60 },
    ...(pin.startsWith("171") ? [] : [{ quoteId: "q2", carrierName: "Xpressbees", carrierCode: "xpressbees", serviceName: "Air", total: 50 }])];
};
vi.mock("@/server/auto-assign", () => {
  const courierKey = (o: { carrierCode: string; serviceName: string }) => `${o.carrierCode}|${o.serviceName}`;
  const pickCourier = async (_org: string, orderId: string, choice = "rules") => {
    choices.push(choice);
    const offers = await offersFor(orderId);
    if (!offers.length) return { ok: false, message: "No courier is serviceable for this order" };
    const o = choice === "rules" ? offers[0] : choice === "cheapest" ? [...offers].sort((a, b) => a.total - b.total)[0] : offers.find((x) => courierKey(x) === choice);
    return o ? { ok: true, offer: o, reason: choice, ruleId: null } : { ok: false, message: "The courier you chose does not serve this order" };
  };
  return { courierKey, pickCourier, autoAssign: (org: string, id: string) => pickCourier(org, id), offersForOrder: async (_org: string, id: string) => ({ ok: true, offers: await offersFor(id) }) };
});
vi.mock("@/server/booking/service", () => ({
  bookOrder: async (a: { orgId: string; orderId: string }) => {
    booked.push(a.orderId);
    const id = `shp_${booked.length}`;
    await db.update(schema.orders).set({ status: "booked" }).where(eq(schema.orders.id, a.orderId));
    await db.insert(schema.shipments).values({ id, orgId: a.orgId, orderId: a.orderId, providerAccountId: "pa", provider: "demo", carrierCode: "delhivery", carrierName: "Delhivery",
      serviceName: "Surface", awb: `AWB${booked.length}`, bookingStatus: "confirmed", status: "booked", quoteId: "q1", sellPaise: 6000, costPaise: 5000, chargeableWeightGrams: 500 });
    return { ok: true, shipmentId: id, awb: `AWB${booked.length}`, state: "confirmed" };
  },
}));

const co = await import("./checkout");
const ops = await import("./ops");
const cat = await import("./catalog");
const dp = await import("./dispatch");
const proc = await import("./process");

const A = "org_dp_a", B = "org_dp_b";
let p1 = "", p2 = "";
const buyer = (pincode: string) => ({ name: "Ravi", mobile: "9876500002", email: "", line1: "2 Mall Rd", line2: "", pincode, city: "Shimla", state: "HP" });
const place = async (k: string, lines: Array<{ productId: string; qty: number }>, pincode = "171001") =>
  (await co.placeOrder("dp-store", co.CheckoutInput.parse({ checkoutKey: `ck_dp_${k}_0123456789`, lines: lines.map((l) => ({ variantId: null, ...l })), buyer: buyer(pincode), paymentMethod: "cod", coupon: "" }))).orderId;
const pages = async (r: { pdf: Uint8Array } | null) => (await PDFDocument.load(r!.pdf)).getPageCount();

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./migrations" });
  for (const o of [A, B]) await db.insert(schema.orgs).values({ id: o, name: o, businessName: o });
  await db.insert(schema.warehouses).values({ id: "wh_dp", orgId: A, label: "Main", contactName: "A", mobile: "9999999999", line1: "x", pincode: "171002", city: "Shimla", state: "HP" });
  await db.insert(schema.stores).values({ id: "st_dp", orgId: A, name: "Dp Store", slug: "dp-store", status: "live", draftTheme: defaultTheme(), publishedTheme: defaultTheme(),
    settings: readSettings({ checkout: { codEnabled: true, warehouseId: "wh_dp", codMaxPaise: 0 } }) });
  p1 = (await cat.saveProduct(A, cat.ProductInput.parse({ title: "Angle Valve", priceRupees: 300, stock: 50, weightGrams: 300, status: "active", sku: "AV-1" }))).id;
  p2 = (await cat.saveProduct(A, cat.ProductInput.parse({ title: "Pillar Cock", priceRupees: 600, stock: 50, weightGrams: 500, status: "active", sku: "PC-2" }))).id;
});

describe("packing & dispatch", () => {
  it("queue holds accepted orders only; slips and pick list are made without changing anything", async () => {
    const a = await place("a", [{ productId: p1, qty: 2 }, { productId: p2, qty: 1 }]);
    const b = await place("b", [{ productId: p1, qty: 1 }]);
    const c = await place("c", [{ productId: p2, qty: 3 }], "999999");
    const pending = await place("d", [{ productId: p1, qty: 1 }]);
    await ops.acceptOrders(A, "u", [a, b, c]);
    const q = await dp.dispatchQueue(A, { view: "all" });
    expect(q.rows.map((r) => r.id).sort()).toEqual([a, b, c].sort());
    expect(q.counts).toMatchObject({ today: 3, overdue: 0, ready: 0, all: 3 });
    expect(await pages(await dp.packingSlipsPdf(A, [a, b, c, pending]))).toBe(2); // 3 short slips, two per sheet; the pending order is left out
    expect(await dp.packingSlipsPdf(A, [pending])).toBeNull();
    expect(await dp.packingSlipsPdf(B, [a])).toBeNull(); // another account's order
    expect(await pages(await dp.pickListPdf(A, [a, b, c]))).toBe(1);
    expect((await db.select().from(schema.storeOrders).where(eq(schema.storeOrders.id, a)))[0].packedAt).toBeNull();
    expect(booked).toHaveLength(0);
  });

  it("pack & book books once per order, reports failures on their own, and a retry books only what failed", async () => {
    const q = await dp.dispatchQueue(A, { view: "all" });
    const ids = q.rows.map((r) => r.id);
    const bad = q.rows.find((r) => r.buyer.pincode === "999999")!.id;
    failPins.add("999999");
    const r1 = await dp.packAndBook(A, "u", ids);
    expect(r1.filter((r) => r.ok)).toHaveLength(2);
    expect(r1.find((r) => r.id === bad)).toMatchObject({ ok: false, message: "No courier is serviceable for this order" });
    expect(booked).toHaveLength(2);
    // everything packed, even the one whose booking failed
    const rows = await db.select().from(schema.storeOrders).where(eq(schema.storeOrders.orgId, A));
    expect(rows.filter((r) => ids.includes(r.id)).every((r) => r.packedAt)).toBe(true);
    // second run: booked ones reuse their AWB (no new booking), the failed one is booked now
    failPins.clear();
    const r2 = await dp.packAndBook(A, "u", ids);
    expect(r2.every((r) => r.ok)).toBe(true);
    expect(r2.filter((r) => r.booked).map((r) => r.id)).toEqual([bad]);
    expect(booked).toHaveLength(3);
    expect(r2.filter((r) => !r.booked).every((r) => r.message === "Already booked: label reused")).toBe(true);
    expect((await dp.shipmentsFor(A, ids)).sort()).toEqual(["shp_1", "shp_2", "shp_3"]);
    expect(await dp.shipmentsFor(B, ids)).toEqual([]);
    const q2 = await dp.dispatchQueue(A, { view: "ready" });
    expect(q2.rows).toHaveLength(3);
    expect(q2.couriers).toEqual(["Delhivery"]);
    expect((await ops.orderTimeline(A, bad)).map((e) => e.kind)).toEqual(["placed", "accepted", "packed", "booked"]);
  });

  it("COD confirmation on: the order waits, unless the seller ships without it; switched off: no wait at all", async () => {
    await db.insert(schema.notificationSettings).values({ id: "ns_dp", orgId: A, channel: "whatsapp", event: "cod_confirmation", enabled: true });
    const held = await place("cod1", [{ productId: p1, qty: 1 }]);
    await ops.acceptOrders(A, "u", [held]);
    const [so] = await db.select().from(schema.storeOrders).where(eq(schema.storeOrders.id, held));
    expect((await db.select().from(schema.orders).where(eq(schema.orders.id, so.shippingOrderId!)))[0].status).toBe("cod_hold");
    const before = booked.length;
    expect(await dp.packAndBook(A, "u", [held])).toMatchObject([{ ok: false, codHold: true, message: "Waiting for the buyer's COD confirmation on WhatsApp" }]);
    expect(booked.length).toBe(before);
    const [r] = await dp.packAndBook(A, "u", [held], { shipWithoutCodConfirmation: [held] });
    expect(r).toMatchObject({ ok: true, booked: true });
    const [c] = await db.select().from(schema.codConfirmations).where(eq(schema.codConfirmations.orderId, so.shippingOrderId!));
    expect(c.status).toBe("confirmed");
    expect((await ops.orderTimeline(A, held)).map((e) => e.message)).toContain("Shipped without the buyer's COD confirmation (seller's decision)");

    // an order held while the service was on is released once the service is switched off
    const held2 = await place("cod2", [{ productId: p1, qty: 1 }]);
    await ops.acceptOrders(A, "u", [held2]);
    await db.update(schema.notificationSettings).set({ enabled: false }).where(eq(schema.notificationSettings.id, "ns_dp"));
    expect((await dp.packAndBook(A, "u", [held2]))[0]).toMatchObject({ ok: true, booked: true });
    const held3 = await place("cod3", [{ productId: p1, qty: 1 }]);
    await ops.acceptOrders(A, "u", [held3]);
    const [so3] = await db.select().from(schema.storeOrders).where(eq(schema.storeOrders.id, held3));
    expect((await db.select().from(schema.orders).where(eq(schema.orders.id, so3.shippingOrderId!)))[0].status).toBe("ready"); // new orders are never held
  });

  it("orders that are not accepted, or belong to someone else, are refused", async () => {
    const pending = await place("e", [{ productId: p1, qty: 1 }]);
    expect(await dp.packAndBook(A, "u", [pending])).toMatchObject([{ ok: false, message: "Accept the order first" }]);
    expect(await dp.packAndBook(B, "u", [pending])).toEqual([]);
  });
});

describe("process orders: print → pack → handover", () => {
  it("each order moves through the steps; delayed, clubbed, duplicates and filters are right", async () => {
    await db.update(schema.notificationSettings).set({ enabled: false });
    const a = await place("pr1", [{ productId: p1, qty: 1 }], "160001");
    const b = await place("pr2", [{ productId: p1, qty: 1 }, { productId: p2, qty: 2 }], "160001"); // same buyer + product → duplicate; 2 lines → clubbed
    await ops.acceptOrders(A, "u", [a, b]);
    let q = await proc.processQueue(A, { step: "print" });
    const row = (id: string) => q.rows.find((r) => r.id === id)!;
    expect(row(a)).toMatchObject({ step: "print", clubbed: false, duplicateOf: expect.any(String) });
    expect(row(b)).toMatchObject({ clubbed: true });
    const clubbed = (await proc.processQueue(A, { step: "print", kind: "clubbed" })).rows.map((r) => r.id);
    expect(clubbed).toContain(b);
    expect(clubbed).not.toContain(a);
    // packing before the label exists is refused
    expect(await proc.markPacked(A, "u", [a])).toMatchObject({ packed: [], skipped: [expect.any(String)] });
    // print: book + label → Pack
    const printed = await dp.packAndBook(A, "u", [a], { markPacked: false });
    expect(printed[0]).toMatchObject({ ok: true, booked: true });
    await proc.markLabelsPrinted(A, [a]);
    q = await proc.processQueue(A, { step: "pack" });
    expect(q.rows.map((r) => r.id)).toContain(a);
    expect((await db.select().from(schema.storeOrders).where(eq(schema.storeOrders.id, a)))[0].packedAt).toBeNull();
    expect((await proc.markPacked(A, "u", [a])).packed).toHaveLength(1);
    q = await proc.processQueue(A, { step: "handover" });
    expect(q.rows.map((r) => r.id)).toContain(a);
    expect((await proc.markHandedOver(A, "u", [a])).handedOver).toHaveLength(1);
    expect((await proc.processQueue(A, { step: "handover" })).rows.find((r) => r.id === a)?.handedOverAt).toBeTruthy();
    // the courier's pickup scan takes it off the list
    const [so] = await db.select().from(schema.storeOrders).where(eq(schema.storeOrders.id, a));
    await db.update(schema.shipments).set({ status: "picked_up" }).where(eq(schema.shipments.orderId, so.shippingOrderId!));
    q = await proc.processQueue(A, {});
    expect(q.rows.some((r) => r.id === a)).toBe(false);
    expect(q.summary.total).toBe(q.summary.print + q.summary.pack + q.summary.handover);
    // dispatch time passed → delayed
    await db.update(schema.storeOrders).set({ placedAt: new Date(Date.now() - 3 * 86_400_000) }).where(eq(schema.storeOrders.id, b));
    expect((await proc.processQueue(A, { delayed: "1" })).rows.map((r) => r.id)).toContain(b);
    // booked long ago and never picked up → Expired AWB
    await dp.packAndBook(A, "u", [b], { markPacked: false });
    const [sb] = await db.select().from(schema.storeOrders).where(eq(schema.storeOrders.id, b));
    await db.update(schema.shipments).set({ createdAt: new Date(Date.now() - 9 * 86_400_000) }).where(eq(schema.shipments.orderId, sb.shippingOrderId!));
    const ex = await proc.processQueue(A, { tab: "expired" });
    expect(ex.rows.map((r) => r.id)).toEqual([b]);
    expect(ex.rows[0].awbAgeDays).toBeGreaterThanOrEqual(9);
    expect((await proc.processQueue(B, {})).rows).toEqual([]);
  });
});

describe("choosing the courier", () => {
  it("rates per courier for the selected orders, cheapest first per order; booking uses the courier you chose", async () => {
    const a = await place("ca", [{ productId: p1, qty: 1 }], "560001");
    const b = await place("cb", [{ productId: p1, qty: 1 }], "171001");
    await ops.acceptOrders(A, "u", [a, b]);
    const r = await dp.courierOptions(A, [a, b]);
    expect(r.considered).toBe(2);
    expect(r.cheapestTotal).toBe(50 + 60);
    expect(r.options).toEqual([
      { key: "delhivery|Surface", carrierName: "Delhivery", serviceName: "Surface", orders: 2, totalPaise: 120, cheapestFor: 1 },
      { key: "xpressbees|Air", carrierName: "Xpressbees", serviceName: "Air", orders: 1, totalPaise: 50, cheapestFor: 1 },
    ]);
    expect((await dp.courierOptions(B, [a])).considered).toBe(0); // another account's orders
    // chosen courier: books only where it serves, the other order waits with a message
    const before = booked.length;
    const res = await dp.packAndBook(A, "u", [a, b], { courier: "xpressbees|Air", markPacked: false });
    expect(res.find((x) => x.id === a)).toMatchObject({ ok: true, booked: true });
    expect(res.find((x) => x.id === b)).toMatchObject({ ok: false, message: "The courier you chose does not serve this order" });
    expect(booked.length).toBe(before + 1);
    expect(choices.slice(-2)).toEqual(["xpressbees|Air", "xpressbees|Air"]);
    // then "Auto · cheapest" for the one left
    const res2 = await dp.packAndBook(A, "u", [b], { courier: "cheapest", markPacked: false });
    expect(res2[0]).toMatchObject({ ok: true, booked: true });
    // clean up for the next tests (cancel both)
    for (const id of [a, b]) await db.update(schema.storeOrders).set({ status: "cancelled" }).where(eq(schema.storeOrders.id, id));
  });
});
