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
vi.mock("@/server/auto-assign", () => ({
  autoAssign: async (_org: string, orderId: string) => {
    const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
    return failPins.has((o.consignee as { pincode: string }).pincode) ? { ok: false, message: "No courier is serviceable for this order" }
      : { ok: true, offer: { quoteId: "q1", carrierName: "Delhivery", carrierCode: "delhivery", total: 60 }, reason: "cheapest", ruleId: null };
  },
}));
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
