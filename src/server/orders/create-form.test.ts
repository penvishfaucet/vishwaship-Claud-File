import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "@/server/db/schema";

const client = new PGlite();
const db = drizzle(client, { schema });
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getDb: async () => db, schema }));
const { createOrderFromForm } = await import("./create-form");
const { invoiceTotals, ewayEnabled, totalWeightKg, dimensionLimitCm } = await import("@/lib/order-form");

const ORG = "org_cf";
const base = (over: Record<string, unknown> = {}) => ({
  orderNumber: `CF${Math.random().toString(36).slice(2, 8).toUpperCase()}`, orderDate: "2026-11-19",
  buyer: { mobile: "9876543210", name: "Asha Rao", line1: "12 MG Road", pincode: "560001", city: "Bengaluru", state: "Karnataka" },
  billingSame: true,
  products: [{ name: "Shoes", qty: 1, unitPriceRupees: 1000 }],
  paymentType: "prepaid", warehouseId: "wh_cf", packageType: "parcel",
  boxes: [{ count: 1, weightKg: 1, lengthCm: 20, breadthCm: 15, heightCm: 10 }],
  ...over,
});

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./migrations" });
  await db.insert(schema.orgs).values({ id: ORG, name: "CF", businessName: "CF Traders" });
  await db.insert(schema.warehouses).values({ id: "wh_cf", orgId: ORG, label: "Main", contactName: "Ravi", mobile: "9876543210", line1: "Plot 1", pincode: "249402", city: "Haridwar", state: "Uttarakhand", code: "W1" });
});

describe("invoice maths (same on the form and the server)", () => {
  it("lines, discount, tax and shipping make the grand total", () => {
    const t = invoiceTotals([{ qty: 2, unitPricePaise: 50_000, discountPaise: 10_000, taxBps: 1800 }, { qty: 1, unitPricePaise: 25_000 }], 5_000);
    expect(t.rows.map((r) => r.total)).toEqual([106_200, 25_000]); // (1000-100) + 18% = 1062
    expect(t.grandTotal).toBe(136_200);
  });
  it("E-Way Bill opens only above ₹50,000", () => {
    expect(ewayEnabled(50_000_00)).toBe(false);
    expect(ewayEnabled(50_000_01)).toBe(true);
  });
  it("box groups add up the actual weight; more than one box limits each side to 306 cm", () => {
    expect(totalWeightKg([{ count: 2, weightKg: 12.5, lengthCm: 1, breadthCm: 1, heightCm: 1 }, { count: 3, weightKg: 4, lengthCm: 1, breadthCm: 1, heightCm: 1 }])).toBe(37);
    expect(dimensionLimitCm([{ count: 1, weightKg: 1, lengthCm: 1, breadthCm: 1, heightCm: 1 }])).toBe(500);
    expect(dimensionLimitCm([{ count: 2, weightKg: 1, lengthCm: 1, breadthCm: 1, heightCm: 1 }])).toBe(306);
  });
});

describe("Create Order submission", () => {
  it("creates a ready order from the required fields only, with server-side totals", async () => {
    const r = await createOrderFromForm(ORG, base({ orderNumber: "CFREQ1" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, r.orderId));
    expect(o).toMatchObject({ status: "ready", mode: "B2C", paymentType: "prepaid", declaredValuePaise: 100_000, ewayBill: null });
    expect(o.meta).toMatchObject({ orderDate: "2026-11-19", billingSame: true, grandTotalPaise: 100_000, packageType: "parcel", totalWeightKg: 1, minChargeableKg: 0.5 });
  });
  it("a repeated submit with the same Order ID never creates a second order", async () => {
    const body = base({ orderNumber: "CFDUP1" });
    const a = await createOrderFromForm(ORG, body);
    const b = await createOrderFromForm(ORG, body);
    expect(a.ok).toBe(true);
    expect(b).toMatchObject({ ok: false, status: 409 });
    if (a.ok && !b.ok) expect(b.duplicateOf).toBe(a.orderId);
    expect((await db.select().from(schema.orders).where(eq(schema.orders.orderNumber, "CFDUP1"))).length).toBe(1);
  });
  it("₹50,000 drops a typed E-Way Bill; ₹50,000.01 keeps it", async () => {
    const at = await createOrderFromForm(ORG, base({ orderNumber: "CFEW1", products: [{ name: "TV", qty: 1, unitPriceRupees: 50000 }], ewayBill: "123456789012" }));
    const above = await createOrderFromForm(ORG, base({ orderNumber: "CFEW2", products: [{ name: "TV", qty: 1, unitPriceRupees: 50000.01 }], ewayBill: "123456789012" }));
    if (!at.ok || !above.ok) throw new Error("not created");
    const [o1] = await db.select().from(schema.orders).where(eq(schema.orders.id, at.orderId));
    const [o2] = await db.select().from(schema.orders).where(eq(schema.orders.id, above.orderId));
    expect(o1.ewayBill).toBeNull();
    expect(o2.ewayBill).toBe("123456789012");
  });
  it("heavy shipment above ₹50,000 needs the E-Way Bill; ROV is saved for heavy only", async () => {
    const r = await createOrderFromForm(ORG, base({ orderNumber: "CFEW3", packageType: "heavy", products: [{ name: "Tiles", qty: 2, unitPriceRupees: 30000 }], boxes: [{ count: 2, weightKg: 40, lengthCm: 80, breadthCm: 50, heightCm: 40 }] }));
    expect(r).toMatchObject({ ok: false, status: 422 });
    if (!r.ok) expect(r.issues?.[0].path).toBe("ewayBill");
    const ok = await createOrderFromForm(ORG, base({ orderNumber: "CFEW4", packageType: "heavy", rovType: "carrier", products: [{ name: "Tiles", qty: 2, unitPriceRupees: 30000 }], boxes: [{ count: 2, weightKg: 40, lengthCm: 80, breadthCm: 50, heightCm: 40 }], ewayBill: "123456789012" }));
    if (!ok.ok) throw new Error(ok.message);
    const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, ok.orderId));
    expect(o.mode).toBe("B2B");
    expect(o.meta).toMatchObject({ rovType: "carrier", totalWeightKg: 80, minChargeableKg: 20 });
  });
  it("points errors at the right fields: missing basics, 306 cm multi-box limit, separate billing", async () => {
    const r = await createOrderFromForm(ORG, base({ buyer: { mobile: "123", name: "", line1: "", pincode: "12", city: "", state: "" }, products: [{ name: "", qty: 0, unitPriceRupees: 0 }], paymentType: undefined, boxes: [{ count: 2, weightKg: 1, lengthCm: 307, breadthCm: 10, heightCm: 10 }], billingSame: false }));
    if (r.ok) throw new Error("should fail");
    const paths = (r.issues ?? []).map((i) => i.path);
    expect(paths).toEqual(expect.arrayContaining(["buyer.mobile", "buyer.name", "buyer.line1", "buyer.pincode", "products.0.name", "products.0.qty", "products.0.unitPriceRupees", "paymentType", "boxes.0.lengthCm", "billing.line1"]));
  });
  it("COD collects the grand total", async () => {
    const r = await createOrderFromForm(ORG, base({ orderNumber: "CFCOD1", paymentType: "cod", products: [{ name: "A", qty: 3, unitPriceRupees: 200 }] }));
    if (!r.ok) throw new Error(r.message);
    const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, r.orderId));
    expect(o).toMatchObject({ paymentType: "cod", codAmountPaise: 60_000, declaredValuePaise: 60_000 });
  });
  it("COD can collect any amount the customer enters; ₹0 is refused; empty means the invoice value", async () => {
    const r = await createOrderFromForm(ORG, base({ orderNumber: "CFCOD2", paymentType: "cod", codAmountRupees: 1234.5, products: [{ name: "A", qty: 1, unitPriceRupees: 600 }] }));
    if (!r.ok) throw new Error(r.message);
    const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, r.orderId));
    expect(o).toMatchObject({ paymentType: "cod", codAmountPaise: 123_450, declaredValuePaise: 60_000 });
    const zero = await createOrderFromForm(ORG, base({ orderNumber: "CFCOD3", paymentType: "cod", codAmountRupees: 0 }));
    expect(zero).toMatchObject({ ok: false, status: 422 });
    if (!zero.ok) expect(zero.issues?.map((i) => i.path)).toContain("codAmountRupees");
    const auto = await createOrderFromForm(ORG, base({ orderNumber: "CFCOD4", paymentType: "cod", codAmountRupees: "" }));
    if (!auto.ok) throw new Error(auto.message);
    const [o2] = await db.select().from(schema.orders).where(eq(schema.orders.id, auto.orderId));
    expect(o2.codAmountPaise).toBe(100_000);
  });
  it("FOD saves as freight-on-delivery with nothing to collect as COD", async () => {
    const r = await createOrderFromForm(ORG, base({ orderNumber: "CFFOD1", paymentType: "fod", packageType: "heavy", products: [{ name: "Tiles", qty: 1, unitPriceRupees: 8000 }], boxes: [{ count: 2, weightKg: 40, lengthCm: 80, breadthCm: 50, heightCm: 40 }] }));
    if (!r.ok) throw new Error(r.message);
    const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, r.orderId));
    expect(o).toMatchObject({ paymentType: "fod", codAmountPaise: 0, declaredValuePaise: 800_000, mode: "B2B" });
  });
});
