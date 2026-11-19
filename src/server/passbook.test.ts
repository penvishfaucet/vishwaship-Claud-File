import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/server/db/schema";

const client = new PGlite();
const db = drizzle(client, { schema });
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getDb: async () => db, schema }));

const { passbookHistory } = await import("./passbook");
const { withLedger } = await import("@/server/ledger/db-store");
const W = await import("@/server/ledger/wallet");
const ORG = "org_pb", OTHER = "org_pb2";
const range = { from: new Date("2020-01-01"), to: new Date(Date.now() + 86400_000) };

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./migrations" });
  await db.insert(schema.orgs).values([{ id: ORG, name: "P", businessName: "P Co" }, { id: OTHER, name: "O", businessName: "O Co" }]);
  await db.insert(schema.wallets).values([{ id: "w_pb", orgId: ORG }, { id: "w_pb2", orgId: OTHER }]);
  await db.insert(schema.orders).values({ id: "o_pb", orgId: ORG, orderNumber: "VS-PB1", mode: "B2C", paymentType: "prepaid", declaredValuePaise: 1000, status: "booked", consignee: { name: "x" } });
  await db.insert(schema.shipments).values({ id: "s_pb", orgId: ORG, orderId: "o_pb", providerAccountId: "pa", provider: "demo", carrierCode: "delhivery", carrierName: "Delhivery", serviceName: "Surface", awb: "AWBPB1", bookingStatus: "confirmed", pickupStatus: "scheduled", status: "booked", quoteId: "q", sellPaise: 24500, costPaise: 1, chargeableWeightGrams: 500 });
  // a credited Razorpay recharge, a shipment charge, a refund, an adjustment
  await db.insert(schema.recharges).values([
    { id: "rc_ok", orgId: ORG, amountPaise: 100000, method: "razorpay", status: "credited", razorpayPaymentId: "pay_OK1", razorpayOrderId: "order_1" },
    { id: "rc_pending", orgId: ORG, amountPaise: 50000, method: "razorpay", status: "payment_pending", razorpayOrderId: "order_2" },
    { id: "rc_failed", orgId: ORG, amountPaise: 70000, method: "razorpay", status: "failed", razorpayOrderId: "order_3" },
    { id: "rc_cancel", orgId: ORG, amountPaise: 80000, method: "razorpay", status: "cancelled", razorpayOrderId: "order_4" },
    { id: "rc_other", orgId: OTHER, amountPaise: 90000, method: "razorpay", status: "payment_pending" },
  ]);
  await withLedger((st) => W.credit(st, { walletId: "w_pb", amount: 100000, kind: "recharge_credit", idempotencyKey: "recharge:rc_ok", refType: "recharge", refId: "rc_ok", memo: "Wallet recharge (Razorpay) · pay_OK1" }));
  await withLedger(async (st) => {
    await W.reserve(st, { walletId: "w_pb", amount: 24500, idempotencyKey: "res:1", reservationId: "r1", refType: "shipment", refId: "s_pb", memo: "hold" });
    await W.settle(st, { walletId: "w_pb", reservationId: "r1", idempotencyKey: "set:1", refType: "shipment", refId: "s_pb", memo: "Shipping charge VS-PB1 · AWBPB1" });
  });
  await withLedger((st) => W.credit(st, { walletId: "w_pb", amount: 5000, kind: "refund_credit", idempotencyKey: "ref:1", refType: "shipment", refId: "s_pb", memo: "Refund" }));
  await withLedger((st) => W.debit(st, { walletId: "w_pb", amount: 1000, kind: "adjustment_debit", idempotencyKey: "adj:1", refType: "staff", refId: "usr_x", memo: "Adjustment: correction" }));
});

describe("wallet passbook", () => {
  it("one chronological history: recharge, shipment charge, refund, adjustment — with signs, references and balance after", async () => {
    const items = await passbookHistory(ORG, range);
    const by = (t: string) => items.filter((i) => i.title === t);
    const rec = by("Wallet Recharge").find((i) => i.direction === "credit")!;
    expect(rec).toMatchObject({ amountPaise: 100000, reference: "pay_OK1", rechargeId: "rc_ok", balanceAfterPaise: 100000, status: "Successful" });
    expect(by("Shipment Charge")[0]).toMatchObject({ direction: "debit", amountPaise: 24500, orderNumber: "VS-PB1", awb: "AWBPB1", balanceAfterPaise: 75500 });
    expect(by("Refund")[0]).toMatchObject({ direction: "credit", amountPaise: 5000 });
    expect(by("Adjustment (debit)")[0]).toMatchObject({ direction: "debit", amountPaise: 1000 });
    expect(items.some((i) => i.title === "reserve" || (i.direction !== "none" && i.amountPaise === 0))).toBe(false); // holds are not money movements
    for (let k = 1; k < items.length; k++) expect(+items[k - 1].at).toBeGreaterThanOrEqual(+items[k].at);
  });

  it("pending, failed and cancelled recharges show their status and are never shown as credited money", async () => {
    const items = await passbookHistory(ORG, range);
    const open = items.filter((i) => i.rechargeId && i.rechargeId !== "rc_ok");
    expect(open.map((i) => i.status).sort()).toEqual(["Cancelled", "Failed", "Payment Pending"]);
    for (const i of open) { expect(i.direction).toBe("none"); expect(i.balanceAfterPaise).toBeNull(); expect(i.description).toMatch(/not credited/); }
    expect(items.some((i) => i.rechargeId === "rc_other")).toBe(false); // another customer's recharge never appears
  });

  it("type filter", async () => {
    expect((await passbookHistory(ORG, { ...range, type: "shipment" })).map((i) => i.title)).toEqual(["Shipment Charge"]);
    expect((await passbookHistory(ORG, { ...range, type: "recharge" })).length).toBe(4);
    expect((await passbookHistory(ORG, { ...range, type: "adjustment" })).map((i) => i.direction)).toEqual(["debit"]);
  });
});
