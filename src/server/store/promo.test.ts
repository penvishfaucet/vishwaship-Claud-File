import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import { defaultTheme, heroSlides, readSettings, sectionMediaIds, storeLink } from "@/lib/store-themes";
import { couponText, saleFor, salePrice } from "@/lib/store-sale";

const client = new PGlite();
const db = drizzle(client, { schema });
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getDb: async () => db, schema }));
vi.mock("@/server/auth/session", () => ({ readSession: async () => null }));

const sales = await import("./sales");
const reviews = await import("./reviews");
const co = await import("./checkout");
const cat = await import("./catalog");

const A = "org_pr_a", B = "org_pr_b";
let shirt = "", mug = "", other = "", catA = "", catB = "";
const hour = 3600_000;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./migrations" });
  for (const o of [A, B]) await db.insert(schema.orgs).values({ id: o, name: o, businessName: o });
  const settings = readSettings({ checkout: { codEnabled: true, warehouseId: "wh_pr" } });
  await db.insert(schema.warehouses).values({ id: "wh_pr", orgId: A, label: "Main", contactName: "A", mobile: "9999999999", line1: "x", pincode: "110034", city: "Delhi", state: "Delhi" });
  await db.insert(schema.stores).values({ id: "st_pr", orgId: A, name: "Promo", slug: "promo-store", status: "live", draftTheme: defaultTheme(), publishedTheme: defaultTheme(), settings });
  await db.insert(schema.stores).values({ id: "st_prb", orgId: B, name: "Other", slug: "other-promo", status: "live", draftTheme: defaultTheme(), publishedTheme: defaultTheme(), settings: readSettings({}) });
  catA = await cat.addCategory(A, "Shirts");
  catB = await cat.addCategory(B, "Elsewhere");
  shirt = (await cat.saveProduct(A, cat.ProductInput.parse({ title: "Linen Shirt", priceRupees: 999, stock: 5, weightGrams: 300, status: "active", categoryId: catA }))).id;
  mug = (await cat.saveProduct(A, cat.ProductInput.parse({ title: "Mug", priceRupees: 349, stock: 5, weightGrams: 300, status: "active" }))).id;
  other = (await cat.saveProduct(B, cat.ProductInput.parse({ title: "Not yours", priceRupees: 100, stock: 5, weightGrams: 300, status: "active" }))).id;
});

describe("pure helpers", () => {
  it("sale price rounds to the rupee and never goes up; best sale wins", () => {
    expect(salePrice(99_900, 20)).toBe(79_900);
    expect(salePrice(21_980, 10)).toBe(19_800);
    expect(salePrice(50, 1)).toBe(50);
    const rules = [
      { id: "a", name: "All", percentOff: 10, scope: "all", categoryIds: [], productIds: [], endsAt: new Date(), bannerText: null },
      { id: "b", name: "Cat", percentOff: 30, scope: "categories", categoryIds: ["c1"], productIds: [], endsAt: new Date(), bannerText: null },
    ];
    expect(saleFor(rules, "p1", "c1")?.id).toBe("b");
    expect(saleFor(rules, "p2", null)?.id).toBe("a");
    expect(couponText({ kind: "percent", value: 1000, minSubtotalPaise: 99_900, maxDiscountPaise: 20_000 })).toBe("10% off on orders above ₹999 (up to ₹200)");
  });

  it("banner links stay inside the store or are https; scripts are dropped", () => {
    expect(storeLink("/shop/?c=kurtas", "/s/x", "/s/x/shop/")).toBe("/s/x/shop/?c=kurtas");
    expect(storeLink("https://wa.me/919999999999", "/s/x", "f")).toBe("https://wa.me/919999999999");
    expect(storeLink("javascript:alert(1)", "/s/x", "f")).toBe("f");
    expect(storeLink("//evil.example", "/s/x", "f")).toBe("/s/x/evil.example");
    expect(storeLink("http://plain.example", "/s/x", "f")).toBe("f");
    const slides = heroSlides({ heading: "One", button: "Go", s2_heading: "Two", s3_text: "no heading so hidden" }, "/s/x", "Store");
    expect(slides.map((s) => s.heading)).toEqual(["One", "Two"]);
    expect(slides[0].buttons[0].href).toBe("/s/x/shop/");
    const t = defaultTheme();
    t.sections[1].settings = { image: "sm_aaaaaaaaaaaa", s2_image: "sm_bbbbbbbbbbbb" };
    expect(sectionMediaIds(t.sections).sort()).toEqual(["sm_aaaaaaaaaaaa", "sm_bbbbbbbbbbbb"]);
  });
});

describe("sale events", () => {
  it("validates scope ownership and dates", async () => {
    const base = { name: "Diwali", percentOff: 20, startsAt: new Date(Date.now() - hour).toISOString(), endsAt: new Date(Date.now() + 24 * hour).toISOString(), bannerText: "", active: true };
    await expect(sales.saveSale(A, sales.SaleInput.parse({ ...base, scope: "categories", categoryIds: [catB] }))).rejects.toThrow(/Category not found/);
    await expect(sales.saveSale(A, sales.SaleInput.parse({ ...base, scope: "products", productIds: [other] }))).rejects.toThrow(/Product not found/);
    await expect(sales.saveSale(A, sales.SaleInput.parse({ ...base, scope: "all", endsAt: base.startsAt }))).rejects.toThrow(/end after/);
    await sales.saveSale(A, sales.SaleInput.parse({ ...base, scope: "categories", categoryIds: [catA] }));
    await sales.saveSale(A, sales.SaleInput.parse({ ...base, name: "Later", scope: "all", percentOff: 50, startsAt: new Date(Date.now() + 2 * hour).toISOString() }));
    expect((await sales.activeSales("st_pr")).map((s) => s.name)).toEqual(["Diwali"]);
    expect(await sales.activeSales("st_prb")).toEqual([]);
  });

  it("checkout charges the sale price computed on the server", async () => {
    const store = await co.liveStore("promo-store");
    const q = await co.quoteCart(store, [{ productId: shirt, variantId: null, qty: 1 }, { productId: mug, variantId: null, qty: 1 }], "");
    expect(q.lines.find((l) => l.productId === shirt)!.unitPaise).toBe(79_900); // 20% off Shirts
    expect(q.lines.find((l) => l.productId === mug)!.unitPaise).toBe(34_900); // not in the sale
  });
});

describe("reviews", () => {
  it("publishes at once, strips links, checks product ownership, drops bots", async () => {
    const store = { id: "st_pr", orgId: A };
    const r = await reviews.addReview(store, shirt, reviews.ReviewInput.parse({ rating: 5, body: "Great fit, see https://spam.example now", name: "Asha", mobile: "9876543210" }));
    expect(r.verified).toBe(false);
    await expect(reviews.addReview(store, other, reviews.ReviewInput.parse({ rating: 4, body: "Nice one", name: "Ravi" }))).rejects.toThrow(/not found/);
    const bot = await reviews.addReview(store, shirt, reviews.ReviewInput.parse({ rating: 1, body: "spam spam", name: "Bot", website: "x" }));
    expect(bot.id).toBeNull();
    const list = await reviews.productReviews("st_pr", shirt);
    expect(list.length).toBe(1);
    expect(list[0].body).toBe("Great fit, see [link removed] now");
  });

  it("verified buyer only when the mobile matches a placed order with that product", async () => {
    await db.insert(schema.storeOrders).values({
      id: "so_pr1", storeId: "st_pr", orgId: A, number: "PR1001", checkoutKey: "ck_pr_1", buyerToken: "t", status: "placed", paymentMethod: "cod", paymentStatus: "cod_pending",
      buyer: { name: "Asha", mobile: "+91 98765 43210" }, lines: [{ productId: shirt, qty: 1, unitPaise: 79_900 }], subtotalPaise: 79_900, totalPaise: 79_900,
    } as typeof schema.storeOrders.$inferInsert);
    const store = { id: "st_pr", orgId: A };
    expect((await reviews.addReview(store, shirt, reviews.ReviewInput.parse({ rating: 4, body: "Bought it, good", name: "Asha", mobile: "9876543210" }))).verified).toBe(true);
    expect((await reviews.addReview(store, mug, reviews.ReviewInput.parse({ rating: 4, body: "Did not buy this", name: "Asha", mobile: "9876543210" }))).verified).toBe(false);
  });

  it("merchant moderation is limited to their own store", async () => {
    const [rv] = await db.select().from(schema.storeReviews).where(eq(schema.storeReviews.storeId, "st_pr")).limit(1);
    await expect(reviews.moderateReview(B, rv.id, "hide")).rejects.toThrow(/not found/);
    await reviews.moderateReview(A, rv.id, "hide");
    expect((await reviews.productReviews("st_pr", rv.productId)).some((x) => x.id === rv.id)).toBe(false);
  });
});
