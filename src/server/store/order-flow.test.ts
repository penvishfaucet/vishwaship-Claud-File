import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import { defaultTheme, readSettings } from "@/lib/store-themes";

// Real SQL on in-memory PGlite; emails are captured; WhatsApp runs in demo mode (no provider in tests).
const client = new PGlite();
const db = drizzle(client, { schema });
const mails: Array<{ event: string; to: string; vars: Record<string, string>; dedupeKey: string }> = [];
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getDb: async () => db, schema }));
vi.mock("@/server/auth/session", () => ({ readSession: async () => null }));
vi.mock("@/server/email/service", () => ({
  sendEmail: async (a: { event: string; to: string; vars: Record<string, string>; dedupeKey: string }) => {
    if (mails.some((m) => m.dedupeKey === a.dedupeKey)) return { status: "duplicate" };
    mails.push(a); return { status: "sent" };
  },
}));

const co = await import("./checkout");
const ops = await import("./ops");
const cat = await import("./catalog");
const stock = await import("./stock");
const inv = await import("./inventory");
const notify = await import("./notify");
const { storePnl } = await import("./pnl");

const A = "org_of_a", B = "org_of_b";
let pid = "";
const buyer = { name: "Meera Shah", mobile: "9876500077", email: "meera@example.test", line1: "5 Lake Rd", line2: "", pincode: "700029", city: "Kolkata", state: "West Bengal" };
const place = async (k: string, qty = 2) => (await co.placeOrder("of-store", co.CheckoutInput.parse({ checkoutKey: `ck_of_${k}_0123456789`, lines: [{ productId: pid, variantId: null, qty }], buyer, paymentMethod: "cod", coupon: "" }))).orderId;
const ist = (s: string) => new Date(`${s}+05:30`);

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./migrations" });
  for (const o of [A, B]) await db.insert(schema.orgs).values({ id: o, name: o, businessName: o });
  await db.insert(schema.warehouses).values({ id: "wh_of", orgId: A, label: "Main", contactName: "A", mobile: "9999999999", line1: "x", pincode: "249402", city: "Haridwar", state: "Uttarakhand" });
  await db.insert(schema.stores).values({ id: "st_of", orgId: A, name: "Penvish Bath", slug: "of-store", status: "live", draftTheme: defaultTheme(), publishedTheme: defaultTheme(),
    settings: readSettings({ checkout: { codEnabled: true, warehouseId: "wh_of", codMaxPaise: 0 } }) });
  pid = (await cat.saveProduct(A, cat.ProductInput.parse({
    title: "Angle Valve", priceRupees: 300, stock: 50, weightGrams: 300, status: "active", sku: "AV-9",
    costs: { productRupees: 120, packagingRupees: 12.5, labourRupees: 5, otherRupees: 0, overheadRupees: 7.5 },
  }))).id;
});

describe("dispatch promise", () => {
  it("24 hours = next day; Sundays are skipped", () => {
    const day = (d: Date) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
    expect(day(notify.dispatchByDate(ist("2026-11-23T15:00:00"), 24))).toBe("2026-11-24"); // Mon → Tue
    expect(day(notify.dispatchByDate(ist("2026-11-28T11:00:00"), 24))).toBe("2026-11-30"); // Sat → Mon
    expect(day(notify.dispatchByDate(ist("2026-11-23T15:00:00"), 48))).toBe("2026-11-25");
    expect(readSettings({}).checkout.dispatchWithinHours).toBe(24); // default: next-day dispatch
  });
});

describe("buyer messages", { timeout: 30_000 }, () => {
  it("accept → one 'order confirmed' email + WhatsApp with the dispatch date and expected delivery", async () => {
    const id = await place("acc");
    await ops.acceptOrders(A, "u1", [id]);
    const jobs = await db.select().from(schema.jobs).where(eq(schema.jobs.dedupeKey, `store.notify:accepted:${id}`));
    expect(jobs).toHaveLength(1);
    const r = await notify.notifyBuyer(id, "accepted");
    expect(r).toEqual({ email: "sent", whatsapp: "sent" });
    const m = mails.find((x) => x.event === "store_order_accepted")!;
    expect(m.to).toBe("meera@example.test");
    expect(m.vars).toMatchObject({ customer_name: "Meera Shah", store_name: "Penvish Bath", order_total: "₹600" });
    expect(m.vars.dispatch_by).toMatch(/\d{2} [A-Z][a-z]{2}/);
    expect(m.vars.payment_line).toMatch(/ready to pay on delivery/);
    const [wa] = await db.select().from(schema.whatsappMessages).where(eq(schema.whatsappMessages.dedupeKey, `wa:store:accepted:${id}`));
    expect(wa).toMatchObject({ event: "store_order_accepted", status: "sent", recipientMasked: "+91••••••0077" });
    // a repeat (job retry) sends nothing new
    expect(await notify.notifyBuyer(id, "accepted")).toEqual({ email: "duplicate", whatsapp: "duplicate" });
    expect((await ops.orderTimeline(A, id)).map((e) => e.kind)).toContain("buyer_accepted_notified");
  });

  it("reject → cancellation email + WhatsApp with the reason (before any shipping order exists)", async () => {
    const id = await place("rej", 1);
    const [res] = await ops.rejectOrders(A, "u1", [id], "Out of stock");
    expect(res.ok).toBe(true);
    const m = mails.find((x) => x.event === "store_order_cancelled" && x.dedupeKey === `store_cancelled:${id}`)!;
    expect(m.vars).toMatchObject({ reason: "Out of stock", refund_line: "You have not been charged." });
    const [wa] = await db.select().from(schema.whatsappMessages).where(eq(schema.whatsappMessages.dedupeKey, `wa:store:cancelled:${id}`));
    expect(wa).toMatchObject({ status: "sent", orderId: null });
  });

  it("the merchant can switch a WhatsApp update off", async () => {
    await db.insert(schema.notificationSettings).values({ id: "ns_of", orgId: A, channel: "whatsapp", event: "store_order_cancelled", enabled: false });
    const id = await place("off", 1);
    await ops.rejectOrders(A, "u1", [id], "Customer asked to cancel");
    const [wa] = await db.select().from(schema.whatsappMessages).where(eq(schema.whatsappMessages.dedupeKey, `wa:store:cancelled:${id}`));
    expect(wa).toMatchObject({ status: "skipped", error: "Turned off by the customer" });
  });

  it("dispatched: once the courier picks it up, one message with the courier and AWB", async () => {
    const id = await place("dsp", 1);
    await ops.acceptOrders(A, "u1", [id]);
    const [o] = await db.select().from(schema.storeOrders).where(eq(schema.storeOrders.id, id));
    await db.insert(schema.shipments).values({ id: "shp_of_1", orgId: A, orderId: o.shippingOrderId!, providerAccountId: "pa", provider: "shipmozo", carrierCode: "delhivery", carrierName: "Delhivery via Shipmozo",
      serviceName: "Surface", awb: "AWBOF1", bookingStatus: "confirmed", status: "picked_up", quoteId: "q", sellPaise: 6000, costPaise: 5000, chargeableWeightGrams: 500, lastEventAt: new Date() });
    expect(await notify.sweepDispatchNotices()).toBeGreaterThanOrEqual(1);
    await notify.notifyBuyer(id, "dispatched");
    const m = mails.find((x) => x.event === "store_order_dispatched")!;
    expect(m.vars).toMatchObject({ awb_number: "AWBOF1" });
    expect(m.vars.courier_name).not.toMatch(/shipmozo/i); // never the aggregator's name
    expect(m.vars.tracking_link).toMatch(/\/t\/t/);
    // already told → the sweep does not queue it again
    const before = (await db.select().from(schema.jobs).where(eq(schema.jobs.queue, "store.notify"))).length;
    await notify.sweepDispatchNotices();
    expect((await db.select().from(schema.jobs).where(eq(schema.jobs.queue, "store.notify"))).length).toBe(before);
  });
});

describe("cost per piece", { timeout: 30_000 }, () => {
  it("product form saves the purchase cost and per-piece extras; the order keeps them when goods leave; P&L shows them", async () => {
    const [p] = await db.select().from(schema.storeProducts).where(eq(schema.storeProducts.id, pid));
    expect(p.unitCostPaise).toBe(12_000);
    expect(p.costExtras).toEqual({ packagingPaise: 1250, labourPaise: 500, otherPaise: 0, overheadPaise: 750 });
    const id = await place("pnl", 2);
    await ops.acceptOrders(A, "u1", [id]);
    const [o] = await db.select().from(schema.storeOrders).where(eq(schema.storeOrders.id, id));
    await db.insert(schema.shipments).values({ id: "shp_of_2", orgId: A, orderId: o.shippingOrderId!, providerAccountId: "pa", provider: "demo", carrierCode: "delhivery", carrierName: "Delhivery",
      serviceName: "Surface", awb: "AWBOF2", bookingStatus: "confirmed", status: "delivered", deliveredAt: new Date(), quoteId: "q", sellPaise: 6000, costPaise: 5000, chargeableWeightGrams: 500 });
    expect(await stock.deductOrderStock(id)).toBe(true);
    const [after] = await db.select().from(schema.storeOrders).where(eq(schema.storeOrders.id, id));
    expect(after.costs).toEqual([{ productId: pid, variantId: null, qty: 2, unitCostPaise: 12_000, extrasPaise: 2500 }]);
    // later price changes do not rewrite this order
    await inv.setCostExtras(A, [pid], { packagingPaise: 9900 });
    const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
    const pl = await storePnl(A, { from: today, to: today });
    const row = pl.orders.find((x) => x.id === id)!;
    expect(row.productCost).toBe(24_000);
    expect(row.packagingCost).toBe(5000);
    expect(row.contribution).toBe(row.netSales + row.shippingCollected - 24_000 - 5000 - row.shippingPaid - row.paymentFees - row.orderExpenses);
    expect(pl.summary.packagingCost).toBeGreaterThanOrEqual(5000);
  });

  it("bulk: CSV import sets per-piece costs; another account's products are never touched", async () => {
    const csv = ["sku,packaging_cost,overhead_cost", "AV-9,15,abc"].join("\n");
    const bad = await inv.planInventoryImport(A, csv);
    expect(bad.rows[0].errors).toEqual(["overhead_cost must be a price like 12.50"]);
    const ok = await inv.runInventoryImport(A, "u1", ["sku,packaging_cost,labour_cost", "AV-9,15,6.5"].join("\n"));
    expect(ok.changed).toBe(1);
    const [p] = await db.select().from(schema.storeProducts).where(eq(schema.storeProducts.id, pid));
    expect(p.costExtras).toEqual({ packagingPaise: 1500, labourPaise: 650, otherPaise: 0, overheadPaise: 750 });
    expect(await inv.setCostExtras(B, [pid], { packagingPaise: 1 })).toBe(0);
    const csvOut = await inv.exportInventoryCsv(A);
    expect(csvOut.split("\r\n")[0]).toContain("packaging_cost,labour_cost,other_cost,overhead_cost");
    expect(csvOut).toContain("15.00,6.50,0.00,7.50");
    void and;
  });
});
