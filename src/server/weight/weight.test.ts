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

describe("courier e-mail paste (Delhivery B2B weight discrepancy mail)", () => {
  const mail = `Dear Client,
LR 323198958 (FoD order) was manifested on 20-11-2026 with an initial charged weight of 30 kg. However, based on a verified and accurate source of weight & dimension capture at our facility, we found that the charged weight of this LR is 41 kg.
As a result, the freight charge of this LR has been increased from INR 739.19 to INR 885.74. Please find the detailed breakup below:
Description Units Invoice Amount
Minimum Charged Weight 20.0Kg/LR
Forward Freight 885.74
Base Charge ₹9.3/Kg 385.16
Pre-tax Freight Charges 750.63
Sub Total 750.63
GST 135.11
Total Rs.885.74

Dear Client,
LR 323196522 (Prepaid order) was manifested on 20-11-2026 with an initial charged weight of 80 kg. ... we found that the charged weight of this LR is 90 kg.
As a result, the freight charge of this LR has been increased from INR 1,500.00 to INR 1,677.00.`;

  it("reads LR, charged weight and the courier's extra (pre-tax) from each mail", () => {
    const rows = svc.parseCourierMails(mail);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ ref: "323198958", grams: 41_000, extraPaise: 75_063 - Math.round(73_919 * 100 / 118) });
    expect(rows[0].extraPaise).toBe(12_420); // ₹750.63 − ₹739.19/1.18
    expect(rows[0].note).toMatch(/30 kg → 41 kg/);
    expect(rows[1]).toMatchObject({ ref: "323196522", grams: 90_000, extraPaise: 15_000 }); // (1677 − 1500)/1.18
    expect(svc.parseWeightReport(mail).rows).toHaveLength(2);
  });

  it("FoD: receiver pays the courier's higher freight; nothing is ever charged to the wallet, client is informed", async () => {
    // FoD booking at 30 kg: freight ₹279 (markup 25%), fuel 15% ₹41.85, other ₹305.58 at cost.
    const fodPriced = { lines: [
      { code: "freight", costPreTax: 27_900, markupEligible: true }, { code: "fuel", costPreTax: 4_185, markupEligible: false }, { code: "other", costPreTax: 30_558, markupEligible: false },
    ], markup: { bps: 2500 }, gstBps: 1800, payer: { basis: "carrier_freight" } };
    await shipment("sh6", "323198958", 30_000, fodPriced);
    const costGst = 62_643 + Math.round(62_643 * 0.18);
    await db.update(schema.shipments).set({ freightPayer: "receiver", receiverFreightPaise: costGst }).where(eq(schema.shipments.id, "sh6"));
    const p = await svc.importWeightReport(mail, { commit: false, actorUserId: STAFF });
    const row = p.rows.find((r) => r.ref === "323198958")!;
    expect(row.status).toBe("ok");
    expect(row.receiverExtraPaise).toBe(14_655); // ₹885.74 − ₹739.19, exactly the courier mail, paid by the receiver
    const c = await svc.importWeightReport(mail, { commit: true, actorUserId: STAFF });
    expect(c.created).toBe(1);
    const [d] = await db.select().from(schema.weightDisputes).where(eq(schema.weightDisputes.shipmentId, "sh6"));
    const [sh] = await db.select().from(schema.shipments).where(eq(schema.shipments.id, "sh6"));
    expect(sh.receiverFreightPaise).toBe(costGst + row.receiverExtraPaise!);
    expect(row.chargePaise ?? 0).toBe(0);
    expect(d).toMatchObject({ chargePaise: 0, status: "open" }); // client can still dispute (FoD)
    expect((await svc.chargeDueDisputes(new Date())).charged).toBe(0);
    expect((await db.select().from(schema.weightDisputes).where(eq(schema.weightDisputes.id, d.id)))[0].status).toBe("open");
    await svc.chargeDueDisputes(new Date(Date.now() + 30 * 86400_000));
    expect((await db.select().from(schema.weightDisputes).where(eq(schema.weightDisputes.id, d.id)))[0].status).toBe("accepted");
    expect((d.evidence as Array<{ label: string }>)[0].label).toMatch(/739\.19 → ₹885\.74/);
    const alerts = await db.select().from(schema.inAppAlerts).where(eq(schema.inAppAlerts.orgId, ORG));
    expect(alerts.some((a) => /Receiver pays/.test(a.title))).toBe(true);
  });

  it("splitForPayer: sender pays all; FoD at Vishwaship rate charges the wallet nothing", () => {
    const calc = computeWeightCharge({ priced: B2B, bookedGrams: 50_000, revisedGrams: 70_000 })!;
    expect(svc.splitForPayer(calc, "sender", undefined)).toEqual({ walletCharge: 31_860, receiverExtra: 0 });
    expect(svc.splitForPayer(calc, "receiver", "vishwaship_rate")).toEqual({ walletCharge: 0, receiverExtra: 31_860 });
    const cf = svc.splitForPayer(calc, "receiver", "carrier_freight");
    expect(cf.receiverExtra).toBe(22_000 + 3_960);
    expect(cf.walletCharge).toBe(0);
  });
});

describe("FoD dispute outcome", () => {
  it("courier accepts the dispute: receiver freight goes back; upheld: closed without any wallet charge", async () => {
    const { resolveWeightDispute } = await import("@/server/admin/disputes");
    const fodPriced = { lines: [{ code: "freight", costPreTax: 27_900, markupEligible: true }], markup: { bps: 2500 }, gstBps: 1800, payer: { basis: "carrier_freight" } };
    for (const id of ["sh7", "sh8"]) {
      await shipment(id, `LR${id}`, 30_000, fodPriced);
      await db.update(schema.shipments).set({ freightPayer: "receiver", receiverFreightPaise: 32_922 }).where(eq(schema.shipments.id, id));
    }
    const a = await svc.raiseWeightDiscrepancy({ shipmentId: "sh7", carrierGrams: 41_000, source: "manual" });
    const b = await svc.raiseWeightDiscrepancy({ shipmentId: "sh8", carrierGrams: 41_000, source: "manual" });
    if (a.status !== "created" || b.status !== "created") throw new Error("not created");
    expect(a.chargePaise).toBe(0);
    const walletBefore = (await wallet()).postedPaise;
    // sh7: client disputed, courier accepted → receiver pays the original freight
    await db.update(schema.weightDisputes).set({ status: "disputed" }).where(eq(schema.weightDisputes.id, a.disputeId));
    expect((await resolveWeightDispute(a.disputeId, "waive", STAFF)).ok).toBe(true);
    expect((await db.select().from(schema.shipments).where(eq(schema.shipments.id, "sh7")))[0].receiverFreightPaise).toBe(32_922);
    // sh8: courier weight stands
    expect((await resolveWeightDispute(b.disputeId, "charge", STAFF)).ok).toBe(true);
    expect((await db.select().from(schema.weightDisputes).where(eq(schema.weightDisputes.id, b.disputeId)))[0].status).toBe("accepted");
    expect((await db.select().from(schema.shipments).where(eq(schema.shipments.id, "sh8")))[0].receiverFreightPaise).toBeGreaterThan(32_922);
    expect((await wallet()).postedPaise).toBe(walletBefore);
  });
});

describe("send dispute to the courier, badges, admin alerts", () => {
  it("saves the courier addresses, mails the client's dispute, records it; counts for badges", async () => {
    const cd = await import("./courier-dispute");
    const { devOutbox } = await import("@/server/email/transport");
    await shipment("sh9", "LR9009", 30_000);
    const r = await svc.raiseWeightDiscrepancy({ shipmentId: "sh9", carrierGrams: 41_000, source: "manual" });
    if (r.status !== "created") throw new Error(r.status);
    expect((await db.select().from(schema.staffAlerts)).some((a) => /LR LR9009: 30\.00 kg → 41\.00 kg/.test(a.title))).toBe(true);
    // client disputes
    const [w] = await db.select().from(schema.weightDisputes).where(eq(schema.weightDisputes.id, r.disputeId));
    await db.update(schema.weightDisputes).set({ status: "disputed", evidence: [...(w.evidence as object[]), { label: "Seller dispute", by: "seller", claimedGrams: 30_000, note: "Box is 34x26x11 cm, 30 kg", urls: ["https://example.com/p1.jpg"] }] }).where(eq(schema.weightDisputes.id, r.disputeId));
    expect((await cd.weightCounts(ORG)).disputed).toBeGreaterThan(0);

    expect((await cd.sendDisputeToCourier(r.disputeId, STAFF)).ok).toBe(false); // no address saved yet
    expect((await cd.saveCourierMailSettings({ to: "not-an-email", cc: "" }, STAFF)).ok).toBe(false);
    expect((await cd.saveCourierMailSettings({ to: "ltl.disputes@delhivery.example, b2b@delhivery.example", cc: "owner@example.com" }, STAFF)).ok).toBe(true);
    const before = devOutbox.length;
    const sent = await cd.sendDisputeToCourier(r.disputeId, STAFF);
    expect(sent).toMatchObject({ ok: true });
    const mails = devOutbox.slice(0, devOutbox.length - before);
    expect(mails.map((m) => m.to).sort()).toEqual(["b2b@delhivery.example", "ltl.disputes@delhivery.example", "owner@example.com"]);
    expect(mails[0].subject).toBe("Weight dispute — LR LR9009");
    expect(mails[0].text).toMatch(/Revised charged weight \(your re-weigh\): 41\.00 kg/);
    expect(mails[0].text).toMatch(/Correct weight as per the shipper: 30\.00 kg/);
    expect(mails[0].text).toMatch(/https:\/\/example\.com\/p1\.jpg/);
    const [after] = await db.select().from(schema.weightDisputes).where(eq(schema.weightDisputes.id, r.disputeId));
    expect((after.evidence as Array<{ by?: string; to?: string[] }>).some((e) => e.by === "vishwaship" && e.to?.length === 3)).toBe(true);
  });
});
