import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import { defaultTheme, readSettings } from "@/lib/store-themes";

const client = new PGlite();
const db = drizzle(client, { schema });
const mails: Array<{ event: string; to: string; vars: Record<string, string> }> = [];
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getDb: async () => db, schema }));
vi.mock("@/server/auth/session", () => ({ readSession: async () => null }));
vi.mock("@/server/email/service", () => ({ sendEmail: async (a: { event: string; to: string; vars: Record<string, string> }) => { mails.push(a); return { status: "sent" }; } }));

const co = await import("./checkout");
const pub = await import("./public");
const billing = await import("./billing");
const cat = await import("./catalog");
const rem = await import("./plan-reminders");

const A = "org_pe_a", DAY = 86_400_000;
const merchant = { userId: "u_pe", kind: "customer" as const };
let pid = "";
const input = (k: string) => co.CheckoutInput.parse({ checkoutKey: `ck_pe_${k}_0123456789`, lines: [{ productId: pid, variantId: null, qty: 1 }], paymentMethod: "cod", coupon: "",
  buyer: { name: "Ravi", mobile: "9876500005", email: "", line1: "1 Road", line2: "", pincode: "110003", city: "Delhi", state: "DL" } });
const setStore = (v: Partial<typeof schema.stores.$inferInsert>) => db.update(schema.stores).set(v).where(eq(schema.stores.id, "st_pe"));

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./migrations" });
  await db.insert(schema.orgs).values({ id: A, name: A, businessName: A });
  await db.insert(schema.wallets).values({ id: "w_pe", orgId: A, postedPaise: 500_000 });
  await db.insert(schema.users).values({ id: "u_pe", kind: "customer", orgId: A, name: "Owner", email: "owner@pe.test", mobile: "9000000005" });
  await db.insert(schema.warehouses).values({ id: "wh_pe", orgId: A, label: "Main", contactName: "A", mobile: "9999999999", line1: "x", pincode: "110001", city: "Delhi", state: "DL" });
  await db.insert(schema.stores).values({ id: "st_pe", orgId: A, name: "Pe Store", slug: "pe-store", status: "live", draftTheme: defaultTheme(), publishedTheme: defaultTheme(),
    settings: readSettings({ checkout: { codEnabled: true, warehouseId: "wh_pe", codMaxPaise: 0 } }), trialEndsAt: new Date(Date.now() + 5 * DAY) });
  pid = (await cat.saveProduct(A, cat.ProductInput.parse({ title: "Tap", priceRupees: 100, stock: 20, weightGrams: 300, status: "active" }))).id;
  await db.insert(schema.storePlans).values({ id: "spl_pe", name: "Monthly", interval: "month", pricePaise: 99_900, active: true, sort: 1 });
});

describe("plan over: the store is unavailable to buyers, the merchant keeps working", () => {
  it("during the trial the store is open", async () => {
    expect((await pub.loadStorefront("pe-store"))?.unavailable).toBe(false);
    expect((await co.placeOrder("pe-store", input("a"))).kind).toBe("placed");
  });

  it("after the trial: unavailable page, no sitemap, every public API refuses; an order already placed can still finish", async () => {
    await setStore({ trialEndsAt: new Date(Date.now() - DAY) });
    const sf = await pub.loadStorefront("pe-store");
    expect(sf).toMatchObject({ unavailable: true, indexable: false, ordersOpen: false });
    await expect(co.liveStore("pe-store")).rejects.toThrow(/not available right now/);
    await expect(co.placeOrder("pe-store", input("b"))).rejects.toThrow(/not taking new orders/);
    // the buyer's retry of the order placed during the trial still answers (no new order is made)
    expect(await co.placeOrder("pe-store", input("a"))).toMatchObject({ kind: "placed" });
    expect((await db.select().from(schema.storeOrders).where(eq(schema.storeOrders.storeId, "st_pe"))).length).toBe(1);
  });

  it("renewal after expiry starts today and reopens the same store; early renewal adds to the end", async () => {
    const now = new Date();
    await billing.buyPlan(A, merchant, "spl_pe", "idem-pe-renew-0001", now);
    let [s] = await db.select().from(schema.stores).where(eq(schema.stores.id, "st_pe"));
    const firstEnd = s.paidUntil!;
    expect(Math.round((firstEnd.getTime() - now.getTime()) / DAY)).toBeGreaterThanOrEqual(28); // from today, not from the old trial end
    expect((await pub.loadStorefront("pe-store"))).toMatchObject({ unavailable: false, ordersOpen: true, indexable: true });
    expect((await co.placeOrder("pe-store", input("c"))).kind).toBe("placed");
    await billing.buyPlan(A, merchant, "spl_pe", "idem-pe-renew-0002", now);
    [s] = await db.select().from(schema.stores).where(eq(schema.stores.id, "st_pe"));
    expect(s.paidUntil!.getTime()).toBeGreaterThan(firstEnd.getTime() + 27 * DAY);
  });

  it("reminders 7 / 3 / 1 days before and at the end, each once (bell + email)", async () => {
    const [s] = await db.select().from(schema.stores).where(eq(schema.stores.id, "st_pe"));
    const end = s.paidUntil!.getTime();
    expect(await rem.sweepPlanReminders(new Date(end - 20 * DAY))).toBe(0);
    expect(await rem.sweepPlanReminders(new Date(end - 6 * DAY))).toBe(1);
    expect(await rem.sweepPlanReminders(new Date(end - 5 * DAY))).toBe(0);
    expect(await rem.sweepPlanReminders(new Date(end - 2 * DAY))).toBe(1);
    expect(await rem.sweepPlanReminders(new Date(end + DAY / 2))).toBe(1);
    expect(await rem.sweepPlanReminders(new Date(end + 10 * DAY))).toBe(0);
    const bell = await db.select().from(schema.inAppAlerts).where(eq(schema.inAppAlerts.orgId, A));
    expect(bell.map((b) => b.title)).toEqual([expect.stringMatching(/ends on .*6 days left/), expect.stringMatching(/2 days left/), expect.stringMatching(/has ended/)]);
    expect(mails.filter((m) => m.event === "store_plan_reminder").map((m) => m.to)).toEqual(["owner@pe.test", "owner@pe.test", "owner@pe.test"]);
  });
});
