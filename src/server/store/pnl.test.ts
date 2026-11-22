import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import { defaultTheme, readSettings } from "@/lib/store-themes";

const client = new PGlite();
const db = drizzle(client, { schema });
const files = new Map<string, Buffer>();
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getDb: async () => db, schema }));
vi.mock("@/server/auth/session", () => ({ readSession: async () => null }));
vi.mock("@/server/email/service", () => ({ sendEmail: async () => ({ status: "sent" }) }));
vi.mock("@/server/storage", async (orig) => ({ ...(await orig<typeof import("@/server/storage")>()), putPrivate: async (k: string, b: Buffer) => { files.set(k, b); }, getPrivate: async (k: string) => files.get(k)! }));

const co = await import("./checkout");
const ops = await import("./ops");
const cat = await import("./catalog");
const stock = await import("./stock");
const inv = await import("./inventory");
const ex = await import("./expenses");
const pnl = await import("./pnl");

const A = "org_pl_a", B = "org_pl_b";
let tap = "";
let n = 0;
const R = { from: "2026-11-01", to: "2026-11-20" };
const at = (d: string) => new Date(`${d}T12:00:00+05:30`);

/** Place, accept, ship (stock deducted, costs captured) and give the shipment a final status. */
async function shipped(status: string, day: string | null, qty = 1, sellPaise = 11_800) {
  n++;
  const { orderId } = await co.placeOrder("pl-store", co.CheckoutInput.parse({ checkoutKey: `ck_pl_${n}_0123456789`, lines: [{ productId: tap, variantId: null, qty }],
    buyer: { name: "Asha", mobile: "9876500004", email: "", line1: "1 Road", line2: "", pincode: "110002", city: "Delhi", state: "DL" }, paymentMethod: "cod", coupon: "" }));
  await ops.acceptOrders(A, "u_pl", [orderId]);
  await stock.deductOrderStock(orderId);
  const [o] = await db.select().from(schema.storeOrders).where(eq(schema.storeOrders.id, orderId));
  await db.insert(schema.shipments).values({ id: `shp_pl${n}`, orgId: A, orderId: o.shippingOrderId!, providerAccountId: "pa", provider: "demo", carrierCode: "demo", carrierName: "Demo",
    serviceName: "S", awb: `AWBPL${n}`, bookingStatus: "confirmed", status, quoteId: "q", sellPaise, costPaise: 1, chargeableWeightGrams: 500,
    deliveredAt: status === "delivered" && day ? at(day) : null, lastEventAt: day ? at(day) : null });
  return o;
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./migrations" });
  await db.insert(schema.orgs).values([{ id: A, name: A, businessName: A, gstin: "07ABCDE1234F1Z5" }, { id: B, name: B, businessName: B }]);
  await db.insert(schema.users).values({ id: "u_pl", kind: "customer", orgId: A, name: "Owner", email: "o@pl.test", mobile: "9000000003" });
  await db.insert(schema.warehouses).values({ id: "wh_pl", orgId: A, label: "Main", contactName: "A", mobile: "9999999999", line1: "x", pincode: "110001", city: "Delhi", state: "DL" });
  await db.insert(schema.stores).values({ id: "st_pl", orgId: A, name: "Pl Store", slug: "pl-store", status: "live", draftTheme: defaultTheme(), publishedTheme: defaultTheme(),
    settings: readSettings({ checkout: { codEnabled: true, warehouseId: "wh_pl", codMaxPaise: 0 } }) });
  // ₹1,180 incl. 18% GST, costs ₹500
  tap = (await cat.saveProduct(A, cat.ProductInput.parse({ title: "Brass Tap", priceRupees: 1180, stock: 50, weightGrams: 300, status: "active", sku: "PL-1", taxPercent: 18 }))).id;
  await db.update(schema.storeProducts).set({ unitCostPaise: 50_000 }).where(eq(schema.storeProducts.id, tap));
});

describe("store P&L", () => {
  it("delivered sale: GST apart, shipping paid ex-GST when registered; RTO is a loss without a sale; pending kept apart", async () => {
    const d = await shipped("delivered", "2026-11-05");
    const rto = await shipped("rto_delivered", "2026-11-07");
    await shipped("in_transit", "2026-11-08");
    await shipped("delivered", "2026-10-20"); // previous period
    await ex.addExpense(A, "u_pl", ex.ExpenseInput.parse({ spentOn: "2026-11-03", category: "packaging", amountPaise: 5_900, orderNumber: d.number }));
    await ex.addExpense(A, "u_pl", ex.ExpenseInput.parse({ spentOn: "2026-11-01", category: "rent", amountPaise: 1_180_000, gstPaise: 180_000, gstRecoverable: true, recurring: true }),
      Buffer.from("%PDF-1.4 test bill"));
    await ex.addExpense(A, "u_pl", ex.ExpenseInput.parse({ spentOn: "2026-11-10", category: "misc", amountPaise: 10_000, gstPaise: 1_000 })); // GST not claimable

    let p = await pnl.storePnl(A, R);
    const dRow = p.orders.find((x) => x.id === d.id)!;
    expect(dRow).toMatchObject({ outcome: "delivered", netSales: 100_000, outputGst: 18_000, productCost: 50_000, shippingPaid: 10_000, orderExpenses: 5_900, contribution: 34_100 });
    const rRow = p.orders.find((x) => x.id === rto.id)!;
    expect(rRow).toMatchObject({ outcome: "rto", netSales: 0, productCost: 50_000, shippingPaid: 10_000, contribution: -60_000 });
    expect(rRow.flags).toContain("return not counted yet");
    expect(p.summary).toMatchObject({ delivered: 1, rto: 1, revenue: 100_000, contribution: 34_100 - 60_000, overhead: 1_000_000 + 10_000, pending: { count: 1, valuePaise: 118_000 }, incomplete: 0 });
    expect(p.summary.net).toBe(34_100 - 60_000 - 1_010_000);
    expect(p.gst).toMatchObject({ registered: true, output: 18_000, inputRecoverable: 1_800 + 1_800 + 180_000, nonRecoverable: 1_000 });
    expect(p.previous.summary).toMatchObject({ delivered: 1, revenue: 100_000 });

    // counting the RTO return puts the sellable piece back: only the shipping stays a loss
    await inv.inspectReturn(A, "u_pl", rto.id, { lines: [{ sellable: 1, damaged: 0, missing: 0 }], note: "" });
    p = await pnl.storePnl(A, R);
    expect(p.orders.find((x) => x.id === rto.id)).toMatchObject({ productCost: 0, contribution: -10_000, flags: [] });
    // margin is blank with no revenue
    expect((await pnl.storePnl(A, { from: "2026-11-15", to: "2026-11-16" })).summary.marginPct).toBeNull();
  });

  it("not registered: no output GST, GST paid is part of the cost; missing costs mark the P&L incomplete", async () => {
    await pnl.savePnlSettings(A, "u_pl", { gstRegistered: false, gatewayFeeBps: 0 });
    const p = await pnl.storePnl(A, R);
    const d = p.orders.find((x) => x.outcome === "delivered")!;
    expect(d).toMatchObject({ netSales: 118_000, outputGst: 0, shippingPaid: 11_800 });
    expect(p.gst.registered).toBe(false);
    expect(p.overhead.find((o) => o.key === "rent")?.amount).toBe(1_180_000);
    await db.update(schema.storeOrders).set({ costs: [{ productId: tap, variantId: null, qty: 1, unitCostPaise: null }] }).where(eq(schema.storeOrders.id, d.id));
    expect((await pnl.storePnl(A, R)).summary.incomplete).toBe(1);
    await pnl.savePnlSettings(A, "u_pl", { gstRegistered: true, gatewayFeeBps: 0 });
  });

  it("expenses: validated, private receipts, soft delete, monthly copies made once", async () => {
    await expect(ex.addExpense(A, "u_pl", ex.ExpenseInput.parse({ spentOn: "2026-11-02", category: "ads", amountPaise: 100, gstPaise: 100 }))).rejects.toThrow(/GST must be less/);
    await expect(ex.addExpense(A, "u_pl", ex.ExpenseInput.parse({ spentOn: "2026-11-02", category: "ads", amountPaise: 100, orderNumber: "NOPE1" }))).rejects.toThrow(/No order/);
    await expect(ex.addExpense(A, "u_pl", ex.ExpenseInput.parse({ spentOn: "2026-11-02", category: "ads", amountPaise: 100 }), Buffer.from("not a bill"))).rejects.toThrow(/JPG, PNG or PDF/);
    const [rent] = (await ex.listExpenses(A, "2026-11-01", "2026-11-01")).map((x) => x.e);
    expect((await ex.expenseReceipt(A, rent.id))?.mime).toBe("application/pdf");
    expect(await ex.expenseReceipt(B, rent.id)).toBeNull();
    expect(await ex.sweepRecurringExpenses(new Date("2027-01-20T10:00:00Z"))).toBe(2); // Dec + Jan
    expect(await ex.sweepRecurringExpenses(new Date("2027-01-20T10:00:00Z"))).toBe(0);
    const copies = await db.select().from(schema.storeExpenses).where(and(eq(schema.storeExpenses.recurringOf, rent.id)));
    expect(copies.map((c) => c.spentOn).sort()).toEqual(["2026-12-01", "2027-01-01"]);
    const misc = (await ex.listExpenses(A, "2026-11-10", "2026-11-10"))[0].e;
    await ex.deleteExpense(A, misc.id);
    await expect(ex.deleteExpense(A, misc.id)).rejects.toThrow(/not found/);
    expect((await pnl.storePnl(A, R)).gst.nonRecoverable).toBe(0);
    await expect(ex.deleteExpense(B, rent.id)).rejects.toThrow(/not found/);
  });
});
