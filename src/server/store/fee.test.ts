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

const fee = await import("./fee");
const ORG = "org_fee";
let n = 0;

/** A store order (₹1,000) with its shipment in the given status. */
async function order(shipStatus: string, opts: { status?: string; total?: number } = {}) {
  n++;
  await db.insert(schema.quotes).values({ id: `q_f${n}`, orgId: ORG, provider: "demo", carrierCode: "demo", serviceName: "S", mode: "B2C", request: {}, priced: {}, totalPaise: 11_800, expiresAt: new Date("2027-01-01") });
  await db.insert(schema.orders).values({ id: `o_f${n}`, orgId: ORG, orderNumber: `F${n}`, mode: "B2C", paymentType: "prepaid", codAmountPaise: 0, declaredValuePaise: 100_000, status: "booked", source: "online_store",
    consignee: { name: "B", mobile: "9876543210", line1: "x", city: "Delhi", state: "DL", pincode: "110001" } });
  await db.insert(schema.shipments).values({ id: `s_f${n}`, orgId: ORG, orderId: `o_f${n}`, providerAccountId: "pa", provider: "demo", carrierCode: "demo", carrierName: "Delhivery", serviceName: "S", awb: `AWBF${n}`,
    bookingStatus: "confirmed", status: shipStatus, quoteId: `q_f${n}`, sellPaise: 11_800, costPaise: 9_000, chargeableWeightGrams: 500 });
  await db.insert(schema.storeOrders).values({ id: `so_f${n}`, storeId: "st_f", orgId: ORG, number: `VS-F${n}`, checkoutKey: `ck${n}`, buyerToken: `bt${n}`, status: opts.status ?? "placed", paymentMethod: "razorpay", paymentStatus: "paid",
    buyer: {}, lines: [], subtotalPaise: opts.total ?? 100_000, shippingPaise: 0, discountPaise: 0, taxPaise: 0, totalPaise: opts.total ?? 100_000, shippingOrderId: `o_f${n}` } as never);
  return `so_f${n}`;
}
const posted = async () => (await db.select().from(schema.wallets).where(eq(schema.wallets.orgId, ORG)))[0].postedPaise;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./migrations" });
  await db.insert(schema.orgs).values({ id: ORG, name: "F", businessName: "F" });
  await db.insert(schema.wallets).values({ id: "w_fee", orgId: ORG, postedPaise: 1_000 });
  await db.insert(schema.stores).values({ id: "st_f", orgId: ORG, slug: "fee-shop", name: "Fee shop" } as never);
});

describe("Online Store fee", () => {
  it("is 1.5% of the order value plus 18% GST", () => {
    expect(fee.storeFee(100_000, 150, 1800)).toEqual({ feePaise: 1_500, gstPaise: 270, totalPaise: 1_770 });
    expect(fee.storeFee(0, 150, 1800).totalPaise).toBe(0);
  });

  it("charges only delivered orders, once each, never RTO / cancelled / in transit; the wallet may go below zero", async () => {
    const delivered = await order("delivered");
    const delivered2 = await order("delivered", { total: 250_000 });
    const rto = await order("rto_delivered");
    const transit = await order("in_transit");
    const cancelled = await order("delivered", { status: "cancelled" });
    expect(await fee.sweepStoreFees()).toBe(2);
    expect(await fee.sweepStoreFees()).toBe(0); // never twice
    expect(await posted()).toBe(1_000 - 1_770 - 4_425);
    const rows = await db.select().from(schema.storeOrders);
    const by = (id: string) => rows.find((r) => r.id === id)!;
    expect([by(delivered).feePaise, by(delivered).feeGstPaise]).toEqual([1_770, 270]);
    expect(by(delivered2).feePaise).toBe(4_425);
    for (const id of [rto, transit, cancelled]) expect(by(id).feeChargedAt).toBeNull();
    const led = await db.select().from(schema.ledgerEntries).where(eq(schema.ledgerEntries.kind, "store_fee"));
    expect(led.map((l) => l.amountPaise).sort()).toEqual([-1_770, -4_425].sort());
    // the in-transit order is charged when it is delivered
    await db.update(schema.shipments).set({ status: "delivered" }).where(eq(schema.shipments.orderId, "o_f4"));
    expect(await fee.sweepStoreFees()).toBe(1);
  });
});
