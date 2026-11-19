import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/server/db/schema";

const client = new PGlite();
const db = drizzle(client, { schema });
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getDb: async () => db, schema }));

const V = await import("./view");
const { orderStatusText, tabOf } = await import("@/lib/order-view");
const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const F = (sp: Record<string, string> = {}) => V.parseOrderFilters({ from: "2020-01-01", to: today, ...sp });

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./migrations" });
  await db.insert(schema.orgs).values([{ id: "org_x", name: "X", businessName: "Xylo Traders" }, { id: "org_y", name: "Y", businessName: "Yarn House" }]);
  const mk = async (id: string, org: string, mode: "B2B" | "B2C", ship?: { status: string; pickup?: string }) => {
    await db.insert(schema.orders).values({ id, orgId: org, orderNumber: `VS-${id}`, mode, paymentType: "prepaid", declaredValuePaise: 1000, status: ship ? "booked" : "ready", consignee: { name: "c", mobile: "9876543210" } });
    if (ship) await db.insert(schema.shipments).values({ id: `s_${id}`, orgId: org, orderId: id, providerAccountId: "pa", provider: "demo", carrierCode: "delhivery", carrierName: "Delhivery", serviceName: "S", awb: `AWB${id}`, bookingStatus: "confirmed", pickupStatus: ship.pickup ?? "scheduled", status: ship.status, quoteId: "q", sellPaise: 1, costPaise: 1, chargeableWeightGrams: 500 });
  };
  await mk("x1", "org_x", "B2C", { status: "in_transit" });
  await mk("x2", "org_x", "B2B", { status: "delivered" });
  await mk("x3", "org_x", "B2C");
  await mk("y1", "org_y", "B2C", { status: "in_transit" });
  await mk("y2", "org_y", "B2C", { status: "cancelled" });
});

describe("Admin All Shipments uses the portal's status logic", () => {
  it("lists every customer; counts per tab add up across customers", async () => {
    const all = await V.adminOrderRows(F());
    expect(new Set(all.rows.map((r) => r.customer.name))).toEqual(new Set(["Xylo Traders", "Yarn House"]));
    const c = await V.tabCounts(null, F());
    expect(c.in_transit).toBe(2);
    expect(c.delivered).toBe(1);
    expect(c.new).toBe(1);
  });
  it("customer filter, customer-name search, type and status filters", async () => {
    expect((await V.adminOrderRows(F({ customer: "org_y" }))).rows.map((r) => r.orderNumber).sort()).toEqual(["VS-y1", "VS-y2"]);
    expect((await V.adminOrderRows(F({ q: "xylo" }))).total).toBe(3);
    expect((await V.adminOrderRows(F({ type: "B2B" }))).rows.map((r) => r.orderNumber)).toEqual(["VS-x2"]);
    expect((await V.adminOrderRows(F({ status: "cancelled" }))).rows.map((r) => r.orderNumber)).toEqual(["VS-y2"]);
    expect((await V.adminOrderRows(F({ tab: "in_transit" }))).total).toBe(2);
  });
  it("the customer's own list never includes another customer, and the status text is the same in both", async () => {
    const mine = await V.listOrderRows("org_x", F());
    expect(mine.rows.every((r) => r.orderNumber.startsWith("VS-x"))).toBe(true);
    expect((await V.tabCounts("org_x", F())).in_transit).toBe(1);
    const admin = (await V.adminOrderRows(F({ customer: "org_x" }))).rows;
    for (const r of mine.rows) {
      const a = admin.find((x) => x.id === r.id)!;
      expect(orderStatusText(a)).toEqual(orderStatusText(r));
      expect(tabOf({ archived: a.archived, orderStatus: a.orderStatus, shipment: a.shipment })).toBe(tabOf({ archived: r.archived, orderStatus: r.orderStatus, shipment: r.shipment }));
    }
  });
});
