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

const { computeWeightCharge } = await import("./calc");
const svc = await import("./service");
const { resolveWeightDispute } = await import("@/server/admin/disputes");
const { b2bChargedWeight } = await import("@/server/providers/delhivery-b2b");

// Delhivery B2B booking: 50 kg, ₹10/kg freight (markup 25%), fuel 10% and docket ₹100 at cost, GST 18%.
const B2B = {
  lines: [
    { code: "freight", label: "Base freight", costPreTax: 50_000, markupEligible: true },
    { code: "fuel", label: "Fuel surcharge", costPreTax: 5_000, markupEligible: false },
    { code: "docket", label: "Docket", costPreTax: 10_000, markupEligible: false },
  ],
  costPreTax: 65_000, eligibleCostPreTax: 50_000, passThroughPreTax: 15_000, markup: { bps: 2500 }, gstBps: 1800, sellingSubtotal: 77_500, gst: 13_950, total: 91_450,
};
const ORG = "org_wd", STAFF = "u_staff";

async function shipment(id: string, awb: string, grams: number, priced: object = B2B) {
  await db.insert(schema.quotes).values({ id: `q_${id}`, orgId: ORG, provider: "delhivery_b2b", carrierCode: "delhivery", serviceName: "B2B Surface", mode: "B2B", request: {}, priced, totalPaise: 91_450, expiresAt: new Date() });
  await db.insert(schema.orders).values({ id: `o_${id}`, orgId: ORG, orderNumber: id, mode: "B2B", paymentType: "prepaid", declaredValuePaise: 1, consignee: {} });
  await db.insert(schema.shipments).values({ id, orgId: ORG, orderId: `o_${id}`, providerAccountId: "pa", provider: "delhivery_b2b", carrierCode: "delhivery", carrierName: "Delhivery", serviceName: "B2B Surface", bookingStatus: "confirmed", status: "in_transit", quoteId: `q_${id}`, sellPaise: 91_450, costPaise: 65_000, chargeableWeightGrams: grams, awb, lrNumber: awb });
}
const wallet = async () => (await db.select().from(schema.wallets).where(eq(schema.wallets.orgId, ORG)))[0];

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./migrations" });
  await db.insert(schema.orgs).values({ id: ORG, name: ORG, businessName: "Asha Traders" });
  await db.insert(schema.wallets).values({ id: "w_wd", orgId: ORG });
});

describe("computeWeightCharge", () => {
  it("re-rates freight + fuel at the booking rate, same markup, GST on top (owner example: 50 → 70 kg = ₹318.60)", () => {
    const c = computeWeightCharge({ priced: B2B, bookedGrams: 50_000, revisedGrams: 70_000 })!;
    expect(c.before.total).toBe(91_450);
    expect(c.after).toMatchObject({ costPreTax: 87_000, subtotal: 104_500, gst: 18_810, total: 123_310 });
    expect(c.extraCostPreTax).toBe(22_000);
    expect(c.chargePaise).toBe(31_860);
    expect(c.basis).toBe("rerated");
  });

  it("uses the courier's own extra amount when the report states it", () => {
    const c = computeWeightCharge({ priced: B2B, bookedGrams: 50_000, revisedGrams: 70_000, courierExtraPreTax: 33_000 })!;
    expect(c.basis).toBe("courier");
    expect(c.extraCostPreTax).toBe(33_000);
    // freight +30000 (marked up 25% → 37500), fuel +3000 at cost → subtotal +40500, ×1.18
    expect(c.chargePaise).toBe(47_790);
  });

  it("no charge when the courier weight is not above the booked weight (no tolerance)", () => {
    expect(computeWeightCharge({ priced: B2B, bookedGrams: 50_000, revisedGrams: 50_000 })).toBeNull();
    expect(computeWeightCharge({ priced: B2B, bookedGrams: 50_000, revisedGrams: 40_000 })).toBeNull();
    expect(computeWeightCharge({ priced: B2B, bookedGrams: 50_000, revisedGrams: 50_001 })!.chargePaise).toBeGreaterThan(0);
  });

  it("all-eligible (whole-rate markup) snapshot and old snapshots without lines", () => {
    const sm = { lines: [{ code: "freight", costPreTax: 10_000, markupEligible: true }], markup: { bps: 2000 }, gstBps: 1800 };
    expect(computeWeightCharge({ priced: sm, bookedGrams: 500, revisedGrams: 1000 })!.chargePaise).toBe(14_160); // +₹100 ×1.2 ×1.18
    expect(computeWeightCharge({ priced: { costPreTax: 10_000, markup: { bps: 2000 } }, bookedGrams: 500, revisedGrams: 1000 })!.chargePaise).toBe(14_160);
  });
});

describe("b2bChargedWeight", () => {
  it("reads only explicitly named charged-weight fields", () => {
    expect(b2bChargedWeight({ data: { weight: 50, charged_weight: 70 } })).toBe(70_000);
    expect(b2bChargedWeight({ data: [{ billed_weight: "72000" }] })).toBe(72_000);
    expect(b2bChargedWeight({ weight: 50_000, status: "In Transit" })).toBeNull();
  });
});

describe("raise, dispute window, auto-charge", () => {
  it("raises once per shipment, stores the courier weight and alerts the client", async () => {
    await shipment("sh1", "LR1001", 50_000);
    const r = await svc.raiseWeightDiscrepancy({ shipmentId: "sh1", carrierGrams: 70_000, source: "api" });
    expect(r).toMatchObject({ status: "created", chargePaise: 31_860 });
    expect((await db.select().from(schema.shipments).where(eq(schema.shipments.id, "sh1")))[0].carrierWeightGrams).toBe(70_000);
    const [d] = await db.select().from(schema.weightDisputes).where(eq(schema.weightDisputes.shipmentId, "sh1"));
    expect(d).toMatchObject({ status: "open", source: "api", bookedChargeableGrams: 50_000, carrierGrams: 70_000 });
    expect(d.deadlineAt.getTime()).toBeGreaterThan(Date.now() + 6.9 * 86400_000);
    expect((await db.select().from(schema.inAppAlerts).where(eq(schema.inAppAlerts.orgId, ORG))).length).toBe(1);
    expect((await svc.raiseWeightDiscrepancy({ shipmentId: "sh1", carrierGrams: 80_000, source: "api" })).status).toBe("exists");
    expect((await wallet()).postedPaise).toBe(0); // nothing debited before the window closes
  });

  it("debits undisputed discrepancies after the deadline, exactly once, with a debit note", async () => {
    expect((await svc.chargeDueDisputes(new Date())).charged).toBe(0);
    const later = new Date(Date.now() + 8 * 86400_000);
    expect((await svc.chargeDueDisputes(later)).charged).toBe(1);
    expect((await svc.chargeDueDisputes(later)).charged).toBe(0);
    expect((await wallet()).postedPaise).toBe(-31_860);
    const [d] = await db.select().from(schema.weightDisputes).where(eq(schema.weightDisputes.shipmentId, "sh1"));
    expect(d.status).toBe("charged");
    expect(d.chargedAt).not.toBeNull();
    const notes = await db.select().from(schema.billingDocuments).where(eq(schema.billingDocuments.refId, d.id));
    expect(notes.map((n) => n.kind)).toEqual(["debit_note"]);
    // waive after charge refunds
    expect((await resolveWeightDispute(d.id, "waive", STAFF)).ok).toBe(true);
    expect((await wallet()).postedPaise).toBe(0);
  });

  it("disputed discrepancies are not auto-charged", async () => {
    await shipment("sh2", "LR1002", 50_000);
    const r = await svc.raiseWeightDiscrepancy({ shipmentId: "sh2", carrierGrams: 60_000, source: "manual" });
    if (r.status !== "created") throw new Error(r.status);
    await db.update(schema.weightDisputes).set({ status: "disputed" }).where(eq(schema.weightDisputes.id, r.disputeId));
    expect((await svc.chargeDueDisputes(new Date(Date.now() + 30 * 86400_000))).charged).toBe(0);
  });
});

describe("courier report import", () => {
  const csv = [
    "LR Number,Entered Weight (kg),Charged Weight (kg),Extra Charge",
    "LR2001,50,70,",
    "LR2002,20,25,\"1,200.00\"",
    "LR2003,30,30,",
    "NOPE,10,20,",
    "LR2001,50,70,",
  ].join("\n");

  it("preview writes nothing; commit raises the valid rows", async () => {
    await shipment("sh3", "LR2001", 50_000);
    await shipment("sh4", "LR2002", 20_000);
    await shipment("sh5", "LR2003", 30_000);
    const before = (await db.select().from(schema.weightDisputes)).length;
    const p = await svc.importWeightReport(csv, { commit: false, actorUserId: STAFF });
    expect(p.rows.map((r) => r.status)).toEqual(["ok", "ok", "no_extra", "not_found", "exists"]);
    expect(p.rows[1].courierExtraPaise).toBe(120_000);
    expect((await db.select().from(schema.weightDisputes)).length).toBe(before);
    const c = await svc.importWeightReport(csv, { commit: true, actorUserId: STAFF });
    expect(c.created).toBe(2);
    expect(c.totalChargePaise).toBe(31_860 + p.rows[1].chargePaise!);
    const [d] = await db.select().from(schema.weightDisputes).where(eq(schema.weightDisputes.shipmentId, "sh4"));
    expect(d).toMatchObject({ source: "csv", courierExtraPaise: 120_000, carrierGrams: 25_000 });
    // re-importing the same file raises nothing new
    expect((await svc.importWeightReport(csv, { commit: true, actorUserId: STAFF })).created).toBe(0);
  });

  it("grams header and missing columns", () => {
    expect(svc.parseWeightReport("AWB,Charged Weight (gm)\nX1,1500").rows[0].grams).toBe(1500);
    expect(svc.parseWeightReport("Foo,Bar\n1,2").error).toMatch(/AWB/);
  });
});
