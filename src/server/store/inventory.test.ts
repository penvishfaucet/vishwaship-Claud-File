import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import { defaultTheme, readSettings } from "@/lib/store-themes";

const client = new PGlite();
const db = drizzle(client, { schema });
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getDb: async () => db, schema }));
vi.mock("@/server/auth/session", () => ({ readSession: async () => null }));
vi.mock("@/server/email/service", () => ({ sendEmail: async () => ({ status: "sent" }) }));

const co = await import("./checkout");
const ops = await import("./ops");
const cat = await import("./catalog");
const stock = await import("./stock");
const inv = await import("./inventory");

const A = "org_inv_a", B = "org_inv_b";
let tap = "", rod = "", rodS = "", rodL = "";
const prod = async (id: string) => (await db.select().from(schema.storeProducts).where(eq(schema.storeProducts.id, id)))[0];
const variant = async (id: string) => (await db.select().from(schema.storeProductVariants).where(eq(schema.storeProductVariants.id, id)))[0];
const adj = (o: Partial<Parameters<typeof inv.adjustStock>[2]> & { kind: "receipt" | "count" | "damage" | "write_off" | "repair"; qty: number }, org = A) =>
  inv.adjustStock(org, "u_inv", { productId: tap, variantId: null, unitCostPaise: null, reason: "", ...o });

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./migrations" });
  for (const o of [A, B]) await db.insert(schema.orgs).values({ id: o, name: o, businessName: o });
  await db.insert(schema.users).values({ id: "u_inv", kind: "customer", orgId: A, name: "Store Owner", email: "o@inv.test", mobile: "9000000002" });
  await db.insert(schema.warehouses).values({ id: "wh_inv", orgId: A, label: "Main", contactName: "A", mobile: "9999999999", line1: "x", pincode: "302001", city: "Jaipur", state: "RJ" });
  await db.insert(schema.stores).values({ id: "st_inv", orgId: A, name: "Inv Store", slug: "inv-store", status: "live", draftTheme: defaultTheme(), publishedTheme: defaultTheme(),
    settings: readSettings({ checkout: { codEnabled: true, warehouseId: "wh_inv", codMaxPaise: 0 } }) });
  await db.insert(schema.stores).values({ id: "st_inv_b", orgId: B, name: "B", slug: "inv-b", status: "live", draftTheme: defaultTheme(), publishedTheme: defaultTheme(), settings: readSettings({}) });
  tap = (await cat.saveProduct(A, cat.ProductInput.parse({ title: "Brass Tap", priceRupees: 500, stock: 10, weightGrams: 300, status: "active", sku: "TAP-1", lowStockAt: 5 }))).id;
  rod = (await cat.saveProduct(A, cat.ProductInput.parse({ title: "Towel Rod", priceRupees: 700, stock: 0, weightGrams: 500, status: "active", options: ["Size"],
    variants: [{ values: ["S"], priceRupees: 700, stock: 4, sku: "ROD-S" }, { values: ["L"], priceRupees: 800, stock: 6, sku: "ROD-L" }] }))).id;
  [rodS, rodL] = (await cat.productVariants(A, rod)).map((v) => v.id);
});

describe("inventory counts", () => {
  it("lists one row per sellable item with on hand = available + held", async () => {
    const { rows, counts } = await inv.inventoryList(A);
    expect(rows.map((r) => [r.sku, r.available, r.onHand])).toEqual([["TAP-1", 10, 10], ["ROD-S", 4, 4], ["ROD-L", 6, 6]]);
    expect(counts).toMatchObject({ all: 3, nocost: 3, low: 1 }); // ROD-S (4) is at/below the default level 5
    expect(await inv.lowStockCount(A)).toBe(1);
    // new products write their opening stock into the history
    expect((await inv.stockHistory(A, tap, null)).map((m) => [m.kind, m.available])).toEqual([["opening", 10]]);
  });

  it("receive with a price keeps a moving average; count, damage, write-off and repair keep counts right", async () => {
    await adj({ kind: "receipt", qty: 10, unitCostPaise: 20_000 });
    expect(await prod(tap)).toMatchObject({ stock: 20, unitCostPaise: 20_000 }); // no cost before: the new price
    await adj({ kind: "receipt", qty: 20, unitCostPaise: 26_000 });
    expect(await prod(tap)).toMatchObject({ stock: 40, unitCostPaise: 23_000 }); // (20×200 + 20×260) / 40
    await expect(adj({ kind: "count", qty: 35 })).rejects.toThrow(/reason/);
    await adj({ kind: "count", qty: 35, reason: "Monthly check" });
    await expect(adj({ kind: "damage", qty: 36, reason: "Broken" })).rejects.toThrow(/Only 35/);
    await adj({ kind: "damage", qty: 3, reason: "Broken in transit" });
    await adj({ kind: "repair", qty: 1 });
    await adj({ kind: "write_off", qty: 2, reason: "Thrown away" });
    await expect(adj({ kind: "write_off", qty: 1, reason: "again" })).rejects.toThrow(/Only 0/);
    expect(await prod(tap)).toMatchObject({ stock: 33, damaged: 0 });
    const h = await inv.stockHistory(A, tap, null);
    expect(h.map((m) => m.kind)).toEqual(["write_off", "repair", "damage", "adjust", "receipt", "receipt", "opening"]);
    expect(h[3]).toMatchObject({ available: -5, reason: "Monthly check", actor: "Store Owner" });
    // another account cannot touch it
    await expect(adj({ kind: "receipt", qty: 5 }, B)).rejects.toThrow(/not found/);
  });

  it("options change their own counts and keep the product totals in step", async () => {
    await expect(inv.adjustStock(A, "u_inv", { productId: rod, variantId: null, kind: "receipt", qty: 2, unitCostPaise: null, reason: "" })).rejects.toThrow(/Choose the option/);
    await inv.adjustStock(A, "u_inv", { productId: rod, variantId: rodS, kind: "receipt", qty: 6, unitCostPaise: 15_000, reason: "Bill 12" });
    await inv.adjustStock(A, "u_inv", { productId: rod, variantId: rodL, kind: "damage", qty: 1, unitCostPaise: null, reason: "Bent" });
    expect(await variant(rodS)).toMatchObject({ stock: 10, unitCostPaise: 15_000 });
    expect(await variant(rodL)).toMatchObject({ stock: 5, damaged: 1 });
    expect(await prod(rod)).toMatchObject({ stock: 15, damaged: 1 });
  });

  it("stock typed in the product editor is recorded as a change", async () => {
    const p = await prod(tap);
    await cat.saveProduct(A, cat.ProductInput.parse({ title: "Brass Tap", priceRupees: 500, stock: 30, weightGrams: 300, status: "active", sku: "TAP-1", lowStockAt: 5 }), tap);
    expect((await inv.stockHistory(A, tap, null))[0]).toMatchObject({ kind: "edit", available: 30 - p.stock });
  });
});

describe("CSV", () => {
  it("previews problems per row and changes only the good rows", async () => {
    const csv = ["sku,available,unit_cost,reorder_level", "TAP-1,25,210.50,8", "ROD-L,,99,", "NOPE,3,,", "ROD-S,abc,,", "TAP-1,1,,"].join("\n");
    const plan = await inv.planInventoryImport(A, csv);
    expect(plan.rows.map((r) => r.errors)).toEqual([[], [], ["No item with this SKU"], ["available must be a whole number"], ["Same SKU twice in the file"]]);
    const r = await inv.runInventoryImport(A, "u_inv", csv);
    expect(r).toEqual({ changed: 2, skipped: 3 });
    expect(await prod(tap)).toMatchObject({ stock: 25, unitCostPaise: 21_050, lowStockAt: 8 });
    expect(await variant(rodL)).toMatchObject({ stock: 5, unitCostPaise: 9_900 });
    expect((await inv.exportInventoryCsv(A)).split("\r\n")[1]).toBe("TAP-1,Brass Tap,,25,0,0,25,8,210.50");
    await expect(inv.planInventoryImport(A, "name,qty\nx,1")).rejects.toThrow(/sku/);
  });
});

describe("returns", () => {
  it("a shipped order's return is counted once: sellable back on sale at its cost, damaged set aside", async () => {
    const { orderId } = await co.placeOrder("inv-store", co.CheckoutInput.parse({ checkoutKey: "ck_inv_ret1_0123456789", lines: [{ productId: tap, variantId: null, qty: 3 }],
      buyer: { name: "Ravi", mobile: "9876500003", email: "", line1: "1 Road", line2: "", pincode: "302002", city: "Jaipur", state: "RJ" }, paymentMethod: "cod", coupon: "" }));
    await ops.acceptOrders(A, "u_inv", [orderId]);
    const p0 = await prod(tap);
    expect(p0).toMatchObject({ stock: 22, reserved: 3 });
    await expect(inv.inspectReturn(A, "u_inv", orderId, { lines: [{ sellable: 3, damaged: 0, missing: 0 }], note: "" })).rejects.toThrow(/shipped/);
    expect(await stock.deductOrderStock(orderId)).toBe(true);
    const [o] = await db.select().from(schema.storeOrders).where(eq(schema.storeOrders.id, orderId));
    await db.insert(schema.shipments).values({ id: "shp_inv1", orgId: A, orderId: o.shippingOrderId!, providerAccountId: "pa", provider: "demo", carrierCode: "demo", carrierName: "Demo",
      serviceName: "S", awb: "AWBINV1", bookingStatus: "confirmed", status: "rto_delivered", quoteId: "q", sellPaise: 1, costPaise: 1, chargeableWeightGrams: 500 });
    expect((await inv.returnsToInspect(A)).map((r) => [r.number, r.kind])).toEqual([[o.number, "RTO"]]);
    expect(await inv.returnsToInspect(B)).toEqual([]);
    await expect(inv.inspectReturn(A, "u_inv", orderId, { lines: [{ sellable: 2, damaged: 0, missing: 0 }], note: "" })).rejects.toThrow(/must be 3/);
    expect(await inv.inspectReturn(A, "u_inv", orderId, { lines: [{ sellable: 2, damaged: 1, missing: 0 }], note: "Box torn" })).toMatchObject({ s: 2, d: 1, m: 0 });
    await expect(inv.inspectReturn(A, "u_inv", orderId, { lines: [{ sellable: 3, damaged: 0, missing: 0 }], note: "" })).rejects.toThrow(/already counted/);
    expect(await prod(tap)).toMatchObject({ stock: 24, reserved: 0, damaged: 1 });
    const back = (await inv.stockHistory(A, tap, null)).find((m) => m.kind === "return_sellable");
    expect(back).toMatchObject({ available: 2, unitCostPaise: 21_050, order: o.number });
    expect(await inv.returnsToInspect(A)).toEqual([]);
  });
});
