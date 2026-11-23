import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import { fromInclusive, presetRange, splitGst } from "@/lib/gst";

const client = new PGlite();
const db = drizzle(client, { schema });
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getDb: async () => db, schema }));

const { collectInvoiceLines } = await import("./invoicing");
const { snapshotFor } = await import("./posting");
const { postNote } = await import("./notes");
const reports = await import("./reports");
const courier = await import("./courier");
const { nextDocNumber } = await import("@/server/billing");
const { can } = await import("@/server/auth/rbac");

const D = (s: string) => new Date(`${s}T12:00:00+05:30`);
const FROM = new Date("2026-04-01T00:00:00+05:30"), TO = new Date("2027-03-31T23:59:59+05:30");
let n = 0;
async function ship(orgId: string, o: { awb: string; sellPaise: number; gstBps?: number; comps?: Array<[string, number]>; at: string; status?: string; deliveredAt?: string; cod?: number }) {
  const id = `shp_${++n}`, orderId = `ord_${n}`, quoteId = `q_${n}`;
  const gstBps = o.gstBps ?? 1800;
  const comps = o.comps ?? [["freight", Math.round((o.sellPaise * 10_000) / (10_000 + gstBps))]];
  const subtotal = comps.reduce((t, [, v]) => t + v, 0);
  const priced = { lines: comps.map(([code, v]) => ({ code, label: code === "freight" ? "Freight" : code === "fuel" ? "Fuel surcharge" : code === "cod_fee" ? "COD fee" : code, costPreTax: v, markupEligible: true, sellPreTax: v })), gstBps, gst: o.sellPaise - subtotal, total: o.sellPaise, sellingSubtotal: subtotal };
  await db.insert(schema.quotes).values({ id: quoteId, orgId, provider: "demo", carrierCode: "dl", serviceName: "Surface", mode: "B2C", request: {}, priced, totalPaise: o.sellPaise, expiresAt: D(o.at) });
  await db.insert(schema.orders).values({ id: orderId, orgId, orderNumber: `ORD-${n}`, mode: "B2C", paymentType: o.cod ? "cod" : "prepaid", codAmountPaise: o.cod ?? 0, declaredValuePaise: 100000, consignee: {}, status: "booked" } as typeof schema.orders.$inferInsert);
  await db.insert(schema.shipments).values({
    id, orgId, orderId, providerAccountId: "pa", provider: "demo", carrierCode: "dl", carrierName: "Delhivery", serviceName: "Surface", awb: o.awb, bookingStatus: "confirmed",
    status: o.status ?? "booked", quoteId, sellPaise: o.sellPaise, costPaise: 0, chargeableWeightGrams: 500, createdAt: D(o.at), deliveredAt: o.deliveredAt ? D(o.deliveredAt) : null,
  });
  return id;
}
async function invoice(orgId: string, from: string, to: string, docDate = new Date()) {
  const { lines } = await collectInvoiceLines(orgId, new Date(`${from}T00:00:00+05:30`), new Date(`${to}T23:59:59+05:30`), 1800);
  if (!lines.length) return null;
  const snap = await snapshotFor(orgId, lines, docDate);
  const id = `doc_inv_${++n}`, number = await nextDocNumber("invoice", docDate);
  const taxable = lines.reduce((t, l) => t + l.taxablePaise, 0), gst = lines.reduce((t, l) => t + l.gstPaise, 0);
  await db.insert(schema.billingDocuments).values({ id, orgId, kind: "invoice", number, docDate, taxablePaise: taxable, gstPaise: gst, totalPaise: taxable + gst, lines: snap.lines, ...snap.fields });
  return { id, number, taxable, gst, lines: snap.lines, fields: snap.fields };
}
async function ledger(orgId: string, entries: Array<[string, number, string]>) {
  let [w] = await db.select().from(schema.wallets).where(eq(schema.wallets.orgId, orgId));
  if (!w) { [w] = await db.insert(schema.wallets).values({ id: `wal_${orgId}`, orgId }).returning(); }
  let bal = 0;
  for (const [kind, amt, at] of entries) { bal += amt; await db.insert(schema.ledgerEntries).values({ id: `le_${++n}`, walletId: w.id, kind, amountPaise: amt, idempotencyKey: `k${n}`, balanceAfterPaise: bal, reservedAfterPaise: 0, createdAt: D(at) }); }
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./migrations" });
  await db.insert(schema.pricingSettings).values([{ key: "gst_bps", value: 1800 }, { key: "company_billing", value: { legalName: "Vishwaship", gstin: "07AAACV1234Q1Z2", address: "Delhi", stateCode: "07", email: "x@y.z", sac: "996812" } }]);
  for (const [id, gstin, state] of [["org_a", "07AAACA1111A1Z1", "Delhi"], ["org_b", "27AAACB2222B1Z2", "Maharashtra"], ["org_c", null, "Chandigarh"], ["org_r", "27AAACR3333C1Z3", "Maharashtra"], ["org_q", "07AAACQ4444D1Z4", "Delhi"]] as const)
    await db.insert(schema.orgs).values({ id, name: id, businessName: `${id} Traders`, gstin, address: { state } });
});

describe("GST arithmetic", () => {
  it("₹1,00,000 tax-inclusive at 18% = ₹84,745.76 taxable + ₹15,254.24 GST", () => {
    expect(fromInclusive(10_000_000, 1800)).toEqual({ taxablePaise: 8_474_576, gstPaise: 1_525_424 });
  });
  it("same state → CGST+SGST (UTGST in Chandigarh), other state → IGST; parts always add up", () => {
    expect(splitGst(1801, "07", "07")).toEqual({ cgstPaise: 900, sgstPaise: 901, utgstPaise: 0, igstPaise: 0 });
    expect(splitGst(1800, "04", "04")).toEqual({ cgstPaise: 900, sgstPaise: 0, utgstPaise: 900, igstPaise: 0 });
    expect(splitGst(1800, "07", "27")).toEqual({ cgstPaise: 0, sgstPaise: 0, utgstPaise: 0, igstPaise: 1800 });
    expect(splitGst(1800, null, "27").igstPaise).toBe(1800); // unknown supplier state never under-reports
  });
  it("presets follow the April–March year in India time", () => {
    const now = new Date("2026-11-23T20:00:00Z"); // 24 Nov IST
    expect(presetRange("this_quarter", now)).toMatchObject({ from: "2026-10-01", to: "2026-11-24" });
    expect(presetRange("last_quarter", now)).toMatchObject({ from: "2026-07-01", to: "2026-09-30" });
    expect(presetRange("this_fy", now)).toMatchObject({ from: "2026-04-01", label: "FY 2026-27" });
    expect(presetRange("last_month", now)).toMatchObject({ from: "2026-10-01", to: "2026-10-31" });
    expect(presetRange("this_week", now)).toMatchObject({ from: "2026-11-23", to: "2026-11-24" });
    expect(presetRange("this_quarter", new Date("2027-02-10T06:00:00Z"))).toMatchObject({ from: "2027-01-01" });
  });
});

describe("1. ₹1,00,000 wallet recharge with partial usage", () => {
  it("top-up, used, refunded and unused balance are separate from billed GST", async () => {
    await ship("org_a", { awb: "A100", sellPaise: 1_180_000, at: "2026-11-02" });
    await ledger("org_a", [["recharge_credit", 10_000_000, "2026-11-01"], ["reserve_settle", -1_180_000, "2026-11-02"], ["credits_purchase", -59_000, "2026-11-03"], ["refund_credit", 118_000, "2026-11-04"], ["store_deposit", -294_882, "2026-11-05"]]);
    const inv = (await invoice("org_a", "2026-11-01", "2026-11-30"))!;
    const s = await reports.summary("org_a", new Date("2026-11-01T00:00:00+05:30"), new Date("2026-11-30T23:59:59+05:30"));
    expect(s.payments).toEqual({ count: 1, amountPaise: 10_000_000 });
    expect(s.wallet.usedPaise).toBe(1_180_000 + 59_000 + 294_882);
    expect(s.wallet.backPaise).toBe(118_000);
    expect(s.wallet.closingPaise).toBe(10_000_000 - 1_180_000 - 59_000 + 118_000 - 294_882);
    // billed: the shipment and the notification credits — never the top-up, never the refundable deposit
    expect(inv.lines.map((l) => l.chargeType).sort()).toEqual(["forward", "non_shipment"]);
    expect(s.invoices.totalPaise).toBe(1_180_000 + 59_000);
    expect(s.invoices.split.cgstPaise + s.invoices.split.sgstPaise).toBe(s.invoices.gstPaise); // Delhi → Delhi
    expect(s.invoices.split.igstPaise).toBe(0);
    // a second run bills nothing new (no double billing)
    expect(await invoice("org_a", "2026-11-01", "2026-11-30")).toBeNull();
  });
});

describe("2. one invoice, several delivered AWBs, mixed rates", () => {
  it("line-level tax, inter-state IGST, and the AWB sheet adds up to the invoice exactly once", async () => {
    await ship("org_b", { awb: "B1", sellPaise: 118_000, gstBps: 1800, comps: [["freight", 90_000], ["fuel", 10_000]], at: "2026-11-05", status: "delivered", deliveredAt: "2026-11-08", cod: 250_000 });
    await ship("org_b", { awb: "B2", sellPaise: 105_000, gstBps: 500, at: "2026-11-06", status: "delivered", deliveredAt: "2026-11-09" });
    await ship("org_b", { awb: "B3", sellPaise: 112_000, gstBps: 1200, comps: [["freight", 80_000], ["cod_fee", 20_000]], at: "2026-11-07", status: "delivered", deliveredAt: "2026-11-10" });
    const inv = (await invoice("org_b", "2026-11-01", "2026-11-30"))!;
    expect(inv.fields.igstPaise).toBe(inv.gst); // Delhi → Maharashtra
    expect(inv.fields.rateBps).toBeNull(); // mixed rates
    expect(inv.taxable + inv.gst).toBe(118_000 + 105_000 + 112_000);
    expect(inv.lines.find((l) => l.awb === "B1" && l.chargeType === "fuel")).toMatchObject({ taxablePaise: 10_000, gstPaise: 1_800 });
    const { rows } = await reports.awbCharges("org_b", new Date("2026-11-01T00:00:00+05:30"), new Date("2026-11-30T23:59:59+05:30"), "delivered");
    expect(rows.reduce((t, r) => t + r.grossPaise, 0)).toBe(inv.taxable + inv.gst);
    expect(rows.reduce((t, r) => t + r.taxablePaise, 0)).toBe(inv.taxable);
    expect(rows.every((r) => r.document === inv.number)).toBe(true);
    expect(rows.find((r) => r.awb === "B1")).toMatchObject({ codValuePaise: 250_000, codRemittance: "Pending" }); // COD value kept apart from fees
    const s = await reports.summary("org_b", new Date("2026-11-01T00:00:00+05:30"), new Date("2026-11-30T23:59:59+05:30"));
    expect(s.invoices.count).toBe(1);
    expect(s.invoices.totalPaise).toBe(inv.taxable + inv.gst);
  });
});

describe("3. RTO after forward billing", () => {
  it("forward charge, its credit note and the separate RTO charge all show on the AWB; the forward is never re-billed", async () => {
    const sid = await ship("org_r", { awb: "R1", sellPaise: 118_000, at: "2026-11-02", status: "rto_delivered" });
    const inv1 = (await invoice("org_r", "2026-11-01", "2026-11-10"))!;
    await db.insert(schema.rtoCharges).values({ id: "rto_1", orgId: "org_r", shipmentId: sid, state: "confirmed", finalPaise: 70_800, gstPaise: 10_800, chargedPaise: 70_800, updatedAt: D("2026-11-15") });
    const cn = await postNote({ orgId: "org_r", kind: "credit_note", totalPaise: 11_800, reason: "Forward freight partly reversed", refType: "shipment", refId: "R1" });
    const inv2 = (await invoice("org_r", "2026-11-11", "2026-11-30"))!;
    expect(inv2.lines.map((l) => l.chargeType)).toEqual(["rto"]);
    expect(inv2.lines[0]).toMatchObject({ taxablePaise: 60_000, gstPaise: 10_800 });
    const [note] = await db.select().from(schema.billingDocuments).where(eq(schema.billingDocuments.id, cn.id));
    expect(note.originalDocId).toBe(inv1.id);
    const { rows } = await reports.awbCharges("org_r", FROM, TO, "rto");
    const net = rows.reduce((t, r) => t + r.grossPaise, 0);
    expect(rows.map((r) => r.billing).sort()).toEqual(["invoiced", "invoiced", "note"]);
    expect(net).toBe(118_000 - 11_800 + 70_800);
  });
});

describe("4. courier bill, partial payment, later credit note", () => {
  it("GST charged, cash paid, outstanding and reconciliation are kept apart; duplicates are refused", async () => {
    const bill = await courier.addCourierBill({ kind: "invoice", supplierName: "Delhivery Ltd", supplierGstin: "27AAACD1234F1Z5", billedGstin: "07AAACV1234Q1Z2", number: "DLV-1", docDate: "2026-11-20", taxablePaise: 100_000, igstPaise: 18_000, lines: [{ awb: "B1", chargeType: "forward", taxablePaise: 60_000, gstPaise: 10_800 }, { awb: "ZZZ-UNKNOWN", taxablePaise: 40_000, gstPaise: 7_200 }] }, "usr");
    expect(bill).toMatchObject({ ok: true, matched: 1, unmatched: 1 });
    expect(await courier.addCourierBill({ kind: "invoice", supplierName: "Delhivery Ltd", number: "DLV-1", docDate: "2026-11-20", taxablePaise: 100_000, igstPaise: 18_000 }, "usr")).toMatchObject({ ok: false, duplicate: true });
    expect(await courier.addCourierBill({ kind: "invoice", supplierName: "Delhivery Ltd", number: "DLV-BAD", docDate: "2026-11-20", taxablePaise: 100_000, igstPaise: 18_000, totalPaise: 200_000 }, "usr")).toMatchObject({ ok: false });
    const pay = await courier.recordCourierPayment({ supplierName: "Delhivery Ltd", amountPaise: 50_000, paidAt: "2026-11-25", reference: "UTR1", allocations: [{ billNumber: "DLV-1", amountPaise: 50_000 }] }, "usr");
    expect(pay).toMatchObject({ ok: true, unallocatedPaise: 0 });
    expect(await courier.recordCourierPayment({ supplierName: "Delhivery Ltd", amountPaise: 50_000, paidAt: "2026-11-25", reference: "UTR1", allocations: [] }, "usr")).toMatchObject({ ok: false, duplicate: true });
    expect(await courier.addCourierBill({ kind: "credit_note", supplierName: "Delhivery Ltd", supplierGstin: "27AAACD1234F1Z5", number: "DLV-CN-1", originalNumber: "DLV-1", docDate: "2026-12-02", taxablePaise: 10_000, igstPaise: 1_800 }, "usr")).toMatchObject({ ok: true });
    const [b] = (await courier.billBalances("Delhivery Ltd")).filter((x) => x.number === "DLV-1");
    expect(b).toMatchObject({ payablePaise: 118_000 - 11_800, paidPaise: 50_000, outstandingPaise: 118_000 - 11_800 - 50_000, gstInPaidPaise: Math.round((50_000 * 18_000) / 118_000) });
    const [sup] = await courier.supplierSummary();
    expect(sup).toMatchObject({ supplierName: "Delhivery Ltd", gstPaise: 18_000 - 1_800, taxablePaise: 100_000 - 10_000, paidPaise: 50_000, outstandingPaise: 56_200 });
    // overpaying an invoice is refused
    expect(await courier.recordCourierPayment({ supplierName: "Delhivery Ltd", amountPaise: 90_000, paidAt: "2026-12-05", reference: "UTR2", allocations: [{ billNumber: "DLV-1", amountPaise: 90_000 }] }, "usr")).toMatchObject({ ok: false });
    const rec = (await courier.awbReconciliation(FROM, TO, "B1"))[0];
    expect(rec).toMatchObject({ awb: "B1", courierTaxable: 60_000, courierGst: 10_800, custTaxable: 100_000, match: "matched" });
    expect((await courier.unmatched()).lines.map((x) => x.l.awb)).toEqual(["ZZZ-UNKNOWN"]);
  });
  it("CSV import groups AWB lines per document and reports duplicates instead of importing twice", async () => {
    const rows = [[...courier.IMPORT_COLUMNS], ["Bluedart", "", "", "invoice", "BD-9", "2026-11-21", "", "", "200.00", "18.00", "18.00", "0", "0", "236.00", "B2", "forward", "200.00", "36.00"]];
    expect(await courier.importCourierRows(rows, "usr")).toMatchObject({ created: 1, matched: 1, errors: [] });
    expect((await courier.importCourierRows(rows, "usr")).duplicates).toHaveLength(1);
    expect((await courier.unmatched()).noGstin.map((b) => b.number)).toContain("BD-9");
  });
});

describe("5. prior-quarter invoice, current-quarter credit note", () => {
  it("each keeps its own GST period; the note points to the original invoice", async () => {
    const old = (await invoice("org_q", "2026-09-01", "2026-09-30", D("2026-09-30")));
    expect(old).toBeNull(); // nothing billable yet in September
    await ship("org_q", { awb: "Q1", sellPaise: 236_000, at: "2026-09-10" });
    const inv = (await invoice("org_q", "2026-09-01", "2026-09-30", D("2026-09-30")))!;
    expect(inv.fields.taxPeriod).toBe("2026-09");
    const cn = await postNote({ orgId: "org_q", kind: "credit_note", totalPaise: 23_600, reason: "Rate correction", refType: "invoice", refId: inv.number });
    const docs = await reports.documents("org_q", FROM, TO);
    const note = docs.find((d) => d.id === cn.id)!;
    expect(note.originalNumber).toBe(inv.number);
    expect(note.taxPeriod).not.toBe("2026-09");
    expect(note.tax.cgstPaise + note.tax.sgstPaise).toBe(note.gstPaise);
    // the September view shows only the invoice; the current view shows only the note
    expect((await reports.summary("org_q", D("2026-09-01"), new Date("2026-09-30T23:59:59+05:30"))).creditNotes.count).toBe(0);
  });
});

describe("6. access", () => {
  it("a customer never sees another customer's documents or AWBs; courier costs need the cost permission", async () => {
    const mine = await reports.documents("org_c", FROM, TO);
    expect(mine).toHaveLength(0);
    expect((await reports.awbCharges("org_c", FROM, TO, "all", "B1")).rows).toHaveLength(0);
    expect((await reports.documents("org_c", FROM, TO, "INV")).length).toBe(0);
    expect(can("readonly", "shipments.cost.read")).toBe(false);
    expect(can("finance", "shipments.cost.read")).toBe(true);
    expect(can("support", "finance.read")).toBe(false);
  });
  it("documents issued before snapshots get a derived split, marked as derived", async () => {
    await db.insert(schema.billingDocuments).values({ id: "doc_legacy", orgId: "org_c", kind: "invoice", number: "VS/INV/2026-27/LEGACY", docDate: D("2026-06-01"), taxablePaise: 10_000, gstPaise: 1_800, totalPaise: 11_800, lines: [{ description: "Shipping", ref: "X", taxablePaise: 10_000, gstPaise: 1_800 }] });
    const [d] = await reports.documents("org_c", FROM, TO);
    expect(d.tax).toMatchObject({ derived: true, igstPaise: 1_800 }); // Delhi → Chandigarh = inter-state
  });
});

describe("CA download pack", () => {
  it("is a valid zip: one workbook whose invoice register matches the period summary, plus a PDF per document", async () => {
    const { inflateRawSync } = await import("node:zlib");
    const { caPack } = await import("./pack");
    const from = new Date("2026-11-01T00:00:00+05:30"), to = new Date("2026-11-30T23:59:59+05:30");
    const pack = await caPack("org_b", from, to);
    // read the zip back (local headers)
    const files = new Map<string, Buffer>();
    for (let o = 0; pack.data.readUInt32LE(o) === 0x04034b50;) {
      const csize = pack.data.readUInt32LE(o + 18), nlen = pack.data.readUInt16LE(o + 26), xlen = pack.data.readUInt16LE(o + 28);
      const name = pack.data.subarray(o + 30, o + 30 + nlen).toString("utf8");
      files.set(name, inflateRawSync(pack.data.subarray(o + 30 + nlen + xlen, o + 30 + nlen + xlen + csize)));
      o += 30 + nlen + xlen + csize;
    }
    const names = [...files.keys()];
    expect(names.filter((n) => n.endsWith(".pdf"))).toHaveLength(1);
    expect(files.get(names.find((n) => n.endsWith(".pdf"))!)!.subarray(0, 4).toString()).toBe("%PDF");
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(files.get(names.find((n) => n.endsWith(".xlsx"))!)! as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Summary", "Invoice Register", "Credit-Debit Notes", "AWB Charges", "Non-shipment Services"]);
    const reg = wb.getWorksheet("Invoice Register")!;
    const gross = Number(reg.getRow(2).getCell(19).value);
    expect(gross).toBe((118_000 + 105_000 + 112_000) / 100);
    const awb = wb.getWorksheet("AWB Charges")!;
    let sum = 0; awb.eachRow((r, i) => { if (i > 1) sum += Number(r.getCell(16).value); });
    expect(Math.round(sum * 100)).toBe(118_000 + 105_000 + 112_000); // each AWB line once, invoice total once
  }, 30_000);
});
