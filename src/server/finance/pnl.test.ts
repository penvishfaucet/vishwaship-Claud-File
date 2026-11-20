import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/server/db/schema";

const client = new PGlite();
const db = drizzle(client, { schema });
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getDb: async () => db, schema }));
const { pnlByOrg } = await import("./pnl");

let k = 0;
const led = (wallet: string, kind: string, amount: number) => db.insert(schema.ledgerEntries).values({ id: `le${++k}`, walletId: wallet, kind, amountPaise: amount, idempotencyKey: `k${k}`, balanceAfterPaise: 0, reservedAfterPaise: 0 });
async function ship(org: string, i: number, sell: number, cost: number, extra: Partial<typeof schema.shipments.$inferInsert> = {}) {
  await db.insert(schema.orders).values({ id: `o_${org}_${i}`, orgId: org, orderNumber: `N${org}${i}`, mode: "B2C", paymentType: "prepaid", declaredValuePaise: 1000, consignee: { name: "x" }, status: "booked" });
  await db.insert(schema.shipments).values({ id: `s_${org}_${i}`, orgId: org, orderId: `o_${org}_${i}`, providerAccountId: "pa", provider: "demo", carrierCode: "demo", carrierName: "Demo", serviceName: "S",
    awb: `A${org}${i}`, bookingStatus: "confirmed", status: "delivered", quoteId: "q", sellPaise: sell, costPaise: cost, chargeableWeightGrams: 500, ...extra });
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./migrations" });
  await db.insert(schema.orgs).values([{ id: "good", name: "Good Co", businessName: "Good Co" }, { id: "bad", name: "Bad Co", businessName: "Bad Co" }]);
  await db.insert(schema.wallets).values([{ id: "wg", orgId: "good", postedPaise: 40_000 }, { id: "wb", orgId: "bad", postedPaise: 0 }]);
  await db.insert(schema.providerAccounts).values({ id: "pa", adapter: "demo", category: "shipping", label: "Demo", status: "enabled" });
  // Good Co: two shipments sold at ₹118 incl. GST (₹100 net) costing ₹70; one cancelled (ignored); weight charge ₹23.60; ₹1,000 recharged
  await ship("good", 1, 11_800, 7_000);
  await ship("good", 2, 11_800, 7_000, { carrierChargePaise: 8_000 }); // courier billed ₹10 more than quoted
  await ship("good", 3, 11_800, 7_000, { status: "cancelled" });
  await led("wg", "recharge_credit", 100_000);
  await led("wg", "reserve_settle", -23_600);
  await led("wg", "weight_charge", -2_360);
  await db.insert(schema.creditEntries).values({ id: "ce1", orgId: "good", kind: "purchase", credits: 400, idempotencyKey: "c1", pricePaise: 8_475, gstPaise: 1_525 });
  // Bad Co: sold at ₹59 incl. GST (₹50 net) but the courier cost ₹80
  await ship("bad", 1, 5_900, 8_000);
});

describe("profit & loss", () => {
  it("per customer: revenue excl. GST, courier cost (confirmed charge first), profit, money flow", async () => {
    const { rows } = await pnlByOrg(null, "good");
    const g = rows[0];
    expect(g.shipments).toBe(2); // cancelled one left out
    expect(g.shippingRevenue).toBe(20_000);
    expect(g.courierCost).toBe(15_000);
    expect(g.carrierExtra).toBe(1_000);
    expect(g.weightRevenue).toBe(2_000);
    expect(g.creditsRevenue).toBe(8_475);
    expect(g.revenue).toBe(30_475);
    expect(g.profit).toBe(15_475);
    expect(g.gstCollected).toBe(3_600 + 360);
    expect(g.recharged).toBe(100_000);
    expect(g.walletBalance).toBe(40_000);
    expect(g.consumed).toBe(25_960);
    expect(g.lossShipments).toBe(0);
  });
  it("overall: a loss-making customer shows a loss, and totals add up", async () => {
    const { rows, total } = await pnlByOrg(null);
    const b = rows.find((r) => r.orgId === "bad")!;
    expect(b.profit).toBe(5_000 - 8_000);
    expect(b.lossShipments).toBe(1);
    expect(total.profit).toBe(15_475 - 3_000);
    expect(rows[0].orgId).toBe("good"); // most profitable first
  });
});
