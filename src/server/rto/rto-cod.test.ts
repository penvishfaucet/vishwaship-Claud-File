import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import * as schema from "@/server/db/schema";

const client = new PGlite();
const db = drizzle(client, { schema });
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getDb: async () => db, schema }));

const rto = await import("./charges");
const cod = await import("@/server/store/cod");

const A = "org_rc_a", B = "org_rc_b";
let n = 0;
const at = (d: string) => new Date(`${d}T12:00:00+05:30`);
const priced = (lines: Array<[string, number]>) => ({ gstBps: 1800, gst: 0, lines: lines.map(([code, sell]) => ({ code, label: code, costPreTax: 0, markupEligible: true, sellPreTax: sell })) });

/** One shipment with its order and quote. */
async function ship(o: { org?: string; status: string; cod?: number; lines?: Array<[string, number]>; delivered?: string; source?: string }) {
  n++;
  const org = o.org ?? A;
  await db.insert(schema.quotes).values({ id: `q_rc${n}`, orgId: org, provider: "demo", carrierCode: "demo", serviceName: "S", mode: "B2C", request: {}, priced: priced(o.lines ?? [["freight", 8_000], ["fuel", 2_000]]), totalPaise: 11_800, expiresAt: at("2027-01-01") });
  await db.insert(schema.orders).values({ id: `o_rc${n}`, orgId: org, orderNumber: `RC${n}`, mode: "B2C", paymentType: o.cod ? "cod" : "prepaid", codAmountPaise: o.cod ?? 0, declaredValuePaise: 50_000, status: "booked",
    source: o.source ?? "online_store", consignee: { name: "B", mobile: "9876543210", line1: "x", city: "Delhi", state: "DL", pincode: "110001" } });
  await db.insert(schema.shipments).values({ id: `s_rc${n}`, orgId: org, orderId: `o_rc${n}`, providerAccountId: "pa", provider: "demo", carrierCode: "demo", carrierName: "Delhivery", serviceName: "S", awb: `AWBRC${n}`,
    bookingStatus: "confirmed", status: o.status, quoteId: `q_rc${n}`, sellPaise: 11_800, costPaise: 9_000, carrierChargePaise: 9_500, chargeableWeightGrams: 500, deliveredAt: o.delivered ? at(o.delivered) : null });
  return `s_rc${n}`;
}
const wallet = async (org: string) => (await db.select().from(schema.wallets).where(eq(schema.wallets.orgId, org)))[0];
const ledger = async (kind: string) => db.select().from(schema.ledgerEntries).where(eq(schema.ledgerEntries.kind, kind));

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./migrations" });
  for (const o of [A, B]) {
    await db.insert(schema.orgs).values({ id: o, name: o, businessName: o });
    await db.insert(schema.wallets).values({ id: `w_${o}`, orgId: o, postedPaise: 100_000 });
  }
});

describe("RTO charges", () => {
  let s1 = "", s2 = "";
  it("opens one record per RTO shipment with an estimate from the booking quote", async () => {
    s1 = await ship({ status: "rto_initiated", lines: [["freight", 8_000], ["rto", 6_000]] });
    s2 = await ship({ status: "rto_delivered" });
    await ship({ status: "delivered", delivered: "2026-11-10" });
    expect(await rto.sweepRtoCharges()).toBe(2);
    expect(await rto.sweepRtoCharges()).toBe(0);
    const rows = await rto.rtoReport(A, {});
    expect(rows.map((r) => [r.awb, r.state, r.rtoChargePaise, r.estimated])).toEqual(expect.arrayContaining([["AWBRC1", "quoted", 7_080, true], ["AWBRC2", "awaiting", 11_800, true]]));
    expect(rows.find((r) => r.awb === "AWBRC2")?.estimateBasis).toMatch(/forward freight/);
    expect(rows[0]).not.toHaveProperty("carrierChargePaise"); // the merchant never sees the carrier's cost
    expect(await rto.rtoReport(B, {})).toEqual([]);
    await db.update(schema.shipments).set({ status: "rto_in_transit" }).where(eq(schema.shipments.id, s1));
    await rto.sweepRtoCharges();
    expect((await rto.rtoReport(A, { awb: "AWBRC1" }))[0].state).toBe("awaiting");
  });

  it("confirm charges the wallet once; adjusting moves only the difference; history keeps every change", async () => {
    await expect(rto.confirmRtoCharge("staff1", { shipmentId: s2, finalPaise: 9_000, source: "carrier_invoice" })).rejects.toThrow(/reference/);
    await expect(rto.confirmRtoCharge("staff1", { shipmentId: s2, finalPaise: 9_000, source: "staff_adjustment" })).rejects.toThrow(/reason/);
    const r1 = await rto.confirmRtoCharge("staff1", { shipmentId: s2, finalPaise: 9_000, gstPaise: 1_373, source: "carrier_invoice", reference: "INV-77" });
    expect(r1).toMatchObject({ state: "reconciled", walletDeltaPaise: 9_000 });
    expect((await wallet(A)).postedPaise).toBe(91_000);
    // same amount again: nothing moves
    expect((await rto.confirmRtoCharge("staff1", { shipmentId: s2, finalPaise: 9_000, source: "carrier_invoice", reference: "INV-77" })).walletDeltaPaise).toBe(0);
    // carrier credit note: ₹20 back
    const r3 = await rto.confirmRtoCharge("staff1", { shipmentId: s2, finalPaise: 9_000, creditsPaise: 2_000, source: "staff_adjustment", reason: "Carrier credit note CN-5" });
    expect(r3).toMatchObject({ walletDeltaPaise: -2_000, state: "reconciled" });
    expect((await wallet(A)).postedPaise).toBe(93_000);
    expect((await ledger("rto_charge")).map((l) => l.amountPaise)).toEqual([-9_000]);
    expect((await ledger("rto_credit")).map((l) => l.amountPaise)).toEqual([2_000]);
    const row = (await rto.rtoReport(A, { awb: "AWBRC2" }))[0];
    expect(row).toMatchObject({ estimated: false, finalChargePaise: 7_000, chargedPaise: 7_000, creditsPaise: 2_000 });
    expect(row.history.map((h) => h.state)).toEqual(["reconciled", "reconciled", "reconciled"]);
    // record only (no wallet): confirmed, and the wallet is not touched
    expect(await rto.confirmRtoCharge("staff1", { shipmentId: s1, finalPaise: 5_000, source: "integration", reference: "API", chargeWallet: false })).toMatchObject({ state: "confirmed", walletDeltaPaise: 0 });
    expect((await wallet(A)).postedPaise).toBe(93_000);
    expect(rto.rtoRow(row)).toContain("INV-77" === row.reference ? "INV-77" : row.reference ?? "");
  });

  it("settlement file: every row checked, only good rows applied", async () => {
    await ship({ status: "rto_delivered" });
    const a3 = `AWBRC${n}`;
    await rto.sweepRtoCharges();
    const csv = ["awb,rto_charge,gst,reference", `${a3},80,12.20,SET-1`, "AWBRC999,50,,", "AWBRC1,40,,", `${a3},10,,`, "AWBRC3,10,,"].join("\n");
    const plan = await rto.importRtoFile("staff1", csv, { apply: false, chargeWallet: true });
    expect(plan.rows.map((r) => r.errors)).toEqual([[], ["AWB not found"], [], ["Same AWB twice in the file"], ["Not an RTO shipment"]]);
    const r = await rto.importRtoFile("staff1", `awb,rto_charge,reference\n${a3},80,SET-1`, { apply: true, chargeWallet: true });
    expect(r.valid).toBe(1);
    expect((await rto.rtoReport(A, { awb: a3 }))[0]).toMatchObject({ source: "settlement_file", finalChargePaise: 8_000, state: "reconciled" });
  });
});

describe("COD reconciliation", () => {
  it("tracks each AWB from collection to payout; one payout covers many AWBs", async () => {
    const waiting = await ship({ status: "in_transit", cod: 50_000, lines: [["freight", 8_000], ["cod_fee", 3_000]] });
    const d1 = await ship({ status: "delivered", cod: 60_000, delivered: "2026-11-05" });
    const d2 = await ship({ status: "delivered", cod: 70_000, delivered: "2026-11-06" });
    const d3 = await ship({ status: "delivered", cod: 40_000, delivered: "2026-11-07" });
    const gone = await ship({ status: "rto_delivered", cod: 30_000 });
    const notStore = await ship({ status: "delivered", cod: 10_000, delivered: "2026-11-07", source: "manual" });
    await db.insert(schema.codRemittances).values([
      { id: "rem1", orgId: A, cycleDate: at("2026-11-10"), expectedPayoutAt: at("2026-11-11"), grossPaise: 130_000, netPaise: 128_000, deductionsPaise: 2_000, deductionNote: "Early COD", status: "paid", paidAt: at("2026-11-11"), reference: "UTR123" },
      { id: "rem2", orgId: A, cycleDate: at("2026-11-14"), expectedPayoutAt: at("2026-11-15"), grossPaise: 40_000, netPaise: 40_000, status: "scheduled" },
    ]);
    await db.insert(schema.codRemittanceItems).values([{ remittanceId: "rem1", shipmentId: d1, codPaise: 60_000 }, { remittanceId: "rem1", shipmentId: d2, codPaise: 65_000 }, { remittanceId: "rem2", shipmentId: d3, codPaise: 40_000 }]);
    const rows = await cod.codShipments(A, { storeOnly: true });
    const st = (id: string) => rows.find((r) => r.shipmentId === id);
    expect(st(waiting)).toMatchObject({ state: "awaiting", collectedPaise: 0, codFeePaise: 3_540 });
    expect(st(d1)).toMatchObject({ state: "remitted", remittedPaise: 60_000, outstandingPaise: 0, utr: "UTR123" });
    expect(st(d2)).toMatchObject({ state: "partial", remittedPaise: 65_000, outstandingPaise: 5_000 });
    expect(st(d3)).toMatchObject({ state: "pending", remittedPaise: 0, outstandingPaise: 40_000 });
    expect(st(gone)).toMatchObject({ state: "not_collectable", outstandingPaise: 0 });
    expect(st(notStore)).toBeUndefined();
    expect(cod.codTotals(rows)).toMatchObject({ collected: 170_000, remitted: 125_000, outstanding: 45_000 });
    const sets = await cod.codSettlements(A, true);
    expect(sets.find((s) => s.id === "rem1")?.awbs.map((a) => a.codPaise)).toEqual([60_000, 65_000]);
    expect(await cod.codShipments(B)).toEqual([]);

    // a question puts it in "disputed" until Vishwaship answers
    await expect(cod.raiseCodDispute(B, "u", d2, "Paid less than due")).rejects.toThrow(/not found/);
    const q = await cod.raiseCodDispute(A, "u", d2, "Paid ₹50 less than due");
    await expect(cod.raiseCodDispute(A, "u", d2, "again please")).rejects.toThrow(/already open/);
    expect((await cod.codShipments(A, { state: "disputed" })).map((r) => r.shipmentId)).toEqual([d2]);
    await cod.resolveCodDispute("staff1", q.id, "₹50 is in the next payout");
    expect((await cod.codShipments(A)).find((r) => r.shipmentId === d2)).toMatchObject({ state: "partial", lastDispute: { resolution: "₹50 is in the next payout" } });
  });

  it("checking a payout file shows matches and every difference without changing anything", async () => {
    const csv = ["awb,amount,utr", "AWBRC" + (n - 4) + ",600,UTR123", "AWBRC" + (n - 3) + ",700,UTR123", "AWBRC" + (n - 2) + ",400,", "NOPE1,100,", "AWBRC1,abc,"].join("\n");
    const r = await cod.compareCodFile(A, csv);
    expect(r.rows.map((x) => x.result)).toEqual(["matched", "amount_differs", "not_remitted", "unknown_awb", "bad_row"]);
    expect(r.rows[1].diffPaise).toBe(5_000);
    expect(r.summary).toMatchObject({ matched: 1, amountDiffers: 1, notRemitted: 1, unknown: 1, bad: 1, missing: 0 });
    const r2 = await cod.compareCodFile(A, `awb,amount\nAWBRC${n - 4},600`);
    expect(r2.missing.map((m) => m.awb)).toEqual([`AWBRC${n - 3}`]);
    const [b] = await db.select().from(schema.codRemittances).where(and(eq(schema.codRemittances.id, "rem1")));
    expect(b.status).toBe("paid");
  });
});
