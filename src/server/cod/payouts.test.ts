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

const rc = await import("./receipts");
const po = await import("./payouts");

const A = "org_cp_a", B = "org_cp_b", C = "org_cp_c";
let n = 0;
const at = (d: string) => new Date(`${d}T12:00:00+05:30`);

/** A delivered (or other) COD shipment; `store` makes it an Online Store order (1.5% + GST fee from its COD). */
async function ship(o: { org: string; cod: number; status?: string; store?: boolean; delivered?: string; prepaid?: boolean }) {
  n++;
  await db.insert(schema.orders).values({ id: `o_cp${n}`, orgId: o.org, orderNumber: `CP${n}`, mode: "B2C", paymentType: o.prepaid ? "prepaid" : "cod", codAmountPaise: o.prepaid ? 0 : o.cod, declaredValuePaise: o.cod, status: "booked",
    consignee: { name: "B", mobile: "9876543210", line1: "x", city: "Delhi", state: "DL", pincode: "110001" } });
  await db.insert(schema.shipments).values({ id: `s_cp${n}`, orgId: o.org, orderId: `o_cp${n}`, providerAccountId: "pa", provider: "demo", carrierCode: "delhivery", carrierName: "Delhivery", serviceName: "S", awb: `2544951599${String(8700 + n)}`,
    bookingStatus: "confirmed", status: o.status ?? "delivered", quoteId: "q", sellPaise: 10_000, costPaise: 8_000, chargeableWeightGrams: 500, deliveredAt: at(o.delivered ?? "2026-11-20") });
  if (o.store) await db.insert(schema.storeOrders).values({ id: `so_cp${n}`, storeId: `st_${o.org}`, orgId: o.org, number: `VS-CP${n}`, checkoutKey: `ck${n}`, buyerToken: `bt${n}`, status: "placed", paymentMethod: "cod", paymentStatus: "cod_pending",
    buyer: {}, lines: [], subtotalPaise: o.cod, shippingPaise: 0, discountPaise: 0, taxPaise: 0, totalPaise: o.cod, shippingOrderId: `o_cp${n}` } as never);
  return { id: `s_cp${n}`, awb: `2544951599${String(8700 + n)}` };
}
const wallet = async (org: string) => (await db.select().from(schema.wallets).where(eq(schema.wallets.orgId, org)))[0];

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./migrations" });
  for (const o of [A, B, C]) {
    await db.insert(schema.orgs).values({ id: o, name: o, businessName: `Client ${o.slice(-1).toUpperCase()}` });
    await db.insert(schema.wallets).values({ id: `w_${o}`, orgId: o, postedPaise: o === B ? -30_000 : 50_000 });
    await db.insert(schema.stores).values({ id: `st_${o}`, orgId: o, slug: `shop-${o}`, name: "Shop" } as never);
  }
});

describe("courier COD file / e-mail", () => {
  it("finds the AWB and COD amount columns under a title row; reads UTR and date; skips totals", () => {
    const grid = [["Shipmozo COD Remittance Report"], [], ["S.No", "AWB Number", "Order ID", "Freight Charges", "COD Amount", "UTR No", "Remittance Date", "Delivered Date"],
      ["1", "'25449515998716", "61041", "120", "1,499.00", "UTIB0000123", "24-11-2026", "20-11-2026"], ["2", "25449515998720", "61042", "90", "₹ 250.5", "", "2026-11-25", ""], ["", "Total", "", "", "1749.50", "", "", ""]];
    const r = rc.codRowsFromGrid(grid);
    expect(r.error).toBeUndefined();
    expect(r.rows.map((x) => [x.awb, x.amountPaise, x.utr, x.remittedOn?.toISOString().slice(0, 10)])).toEqual([["25449515998716", 149_900, "UTIB0000123", "2026-11-24"], ["25449515998720", 25_050, null, "2026-11-25"]]);
    expect(rc.codRowsFromGrid([["Name", "Amount"], ["x", "1"]]).error).toMatch(/AWB/);
  });

  it("reads a Delhivery COD remittance e-mail (table lines, mail-level UTR and date); other mails give nothing", () => {
    const mail = "Dear Partner,\nCOD remittance for your account has been processed.\nUTR No: HDFCR52026112412345\nRemittance Date: 24-11-2026\nWaybill  Amount\n25449515998716  1499.00\n25449515998720  250.50\nTotal 1749.50";
    const rows = rc.codRowsFromMail("COD Remittance Advice", mail);
    expect(rows.map((x) => [x.awb, x.amountPaise, x.utr, x.remittedOn?.toISOString().slice(0, 10)])).toEqual([["25449515998716", 149_900, "HDFCR52026112412345", "2026-11-24"], ["25449515998720", 25_050, "HDFCR52026112412345", "2026-11-24"]]);
    expect(rc.codRowsFromMail("Weight discrepancy", "LR 323404758 charged weight 41 kg")).toEqual([]);
  });
});

describe("COD payouts to clients", () => {
  const s: Record<string, { id: string; awb: string }> = {};
  it("records the courier's COD per AWB: full amount ready, a short amount and unknown AWBs held for checking; preview writes nothing", async () => {
    s.a1 = await ship({ org: A, cod: 100_000, store: true });
    s.a2 = await ship({ org: A, cod: 50_000 });
    s.a3 = await ship({ org: A, cod: 40_000 }); // courier has not paid yet
    s.b1 = await ship({ org: B, cod: 60_000 });
    s.c1 = await ship({ org: C, cod: 20_000 });
    s.c2 = await ship({ org: C, cod: 30_000 }); // courier paid less
    const rows = [s.a1, s.a2, s.b1, s.c1].map((x, i) => ({ line: i + 2, awb: x.awb, amountPaise: [100_000, 50_000, 60_000, 20_000][i], utr: "UTR1", remittedOn: at("2026-11-24") }));
    rows.push({ line: 9, awb: s.c2.awb, amountPaise: 25_000, utr: "UTR1", remittedOn: null }, { line: 10, awb: "99999999999999", amountPaise: 1_000, utr: null, remittedOn: null });
    const preview = await rc.importCodReceipts(rows, { source: "courier_file", actorUserId: "st", commit: false });
    expect(preview.rows.map((r) => r.status)).toEqual(["matched", "matched", "matched", "matched", "short", "unknown_awb"]);
    expect(await db.select().from(schema.codReceipts)).toHaveLength(0);
    const r = await rc.importCodReceipts(rows, { source: "courier_file", fileName: "cod.xlsx", actorUserId: "st", commit: true });
    expect([r.matched, r.flagged]).toEqual([4, 2]);
    // the same file again updates, never duplicates
    await rc.importCodReceipts(rows, { source: "courier_file", actorUserId: "st", commit: true });
    expect(await db.select().from(schema.codReceipts)).toHaveLength(6);
  });

  it("preview per client: store fee 1.5% + GST, wallet dues cleared from COD, no bank → held; unpaid AWBs wait", async () => {
    await po.savePayoutAccount(A, { holderName: "Client A", accountNumber: "1234 5678 9012", ifsc: "hdfc0001234", bankName: "HDFC" }, "st");
    await po.savePayoutAccount(B, { holderName: "Client B", accountNumber: "555566667777", ifsc: "SBIN0000001" }, "st");
    const p = await po.payoutPreview(at("2026-11-24"));
    const a = p.find((x) => x.orgId === A)!, b = p.find((x) => x.orgId === B)!, c = p.find((x) => x.orgId === C)!;
    expect(a).toMatchObject({ grossPaise: 150_000, storeFeePaise: 1_770, storeOrders: 1, duesPaise: 0, netPaise: 148_230, awaitingCourier: 1, awaitingCourierPaise: 40_000, blocked: null });
    expect(a.bank).toEqual({ holderName: "Client A", last4: "9012", ifsc: "HDFC0001234", bankName: "HDFC" });
    expect(b).toMatchObject({ grossPaise: 60_000, duesPaise: 30_000, netPaise: 30_000 });
    expect(c).toMatchObject({ grossPaise: 20_000, blocked: "No payout bank account", awaitingCourier: 1 });
    await expect(po.savePayoutAccount(C, { holderName: "C", accountNumber: "12", ifsc: "X" }, "st")).rejects.toThrow(/Account number/);
  });

  it("Pay all: one payout per ready client, dues credited to the wallet, store fee recorded once; bank file and mark paid", async () => {
    const run = await po.createPayoutRun("staff1", undefined, at("2026-11-24"));
    expect(run.made.map((m) => [m.name, m.netPaise, m.shipments]).sort()).toEqual([["Client A", 148_230, 2], ["Client B", 30_000, 1]]);
    expect(run.skipped).toEqual([{ orgId: C, name: "Client C", reason: "No payout bank account" }]);
    expect((await wallet(B)).postedPaise).toBe(0); // ₹300 dues paid from COD
    const so = (await db.select().from(schema.storeOrders).where(eq(schema.storeOrders.id, "so_cp1")))[0];
    expect([so.feeVia, so.feePaise, so.feeGstPaise]).toEqual(["cod", 1_770, 270]);
    // nothing is paid twice
    expect((await po.createPayoutRun("staff1", undefined, at("2026-11-24"))).made).toEqual([]);
    const f = await po.bankFileCsv(run.made.map((m) => m.id));
    expect(f.count).toBe(2);
    expect(f.totalPaise).toBe(178_230);
    expect(f.csv).toContain("Client A,123456789012,HDFC0001234,1482.30");
    expect(f.csv).toContain("Client B,555566667777,SBIN0000001,300.00");
    const paid = await po.markPayoutsPaid(run.made.map((m) => ({ id: m.id, reference: "NEFT-BATCH-1" })));
    expect(paid).toHaveLength(2);
    expect((await po.bankFileCsv(run.made.map((m) => m.id))).count).toBe(0);
  });

  it("an accepted short amount is paid as the courier paid it; cancelling a payout returns its shipments and reverses the dues credit", async () => {
    await po.savePayoutAccount(C, { holderName: "Client C", accountNumber: "999988887777", ifsc: "ICIC0000001" }, "st");
    const short = (await db.select().from(schema.codReceipts).where(eq(schema.codReceipts.awb, s.c2.awb)))[0];
    expect((await rc.acceptReceipt(short.id, "staff1")).ok).toBe(true);
    await db.update(schema.wallets).set({ postedPaise: -5_000 }).where(eq(schema.wallets.orgId, C));
    const run = await po.createPayoutRun("staff1", [C], at("2026-11-25"));
    expect(run.made).toEqual([expect.objectContaining({ name: "Client C", netPaise: 40_000, shipments: 2 })]); // 200 + 250 − 50 dues
    expect((await wallet(C)).postedPaise).toBe(0);
    await po.cancelPayout(run.made[0].id);
    expect((await wallet(C)).postedPaise).toBe(-5_000);
    const again = await po.payoutPreview(at("2026-11-25"), [C]);
    expect(again[0]).toMatchObject({ grossPaise: 45_000, netPaise: 40_000 });
  });

  it("Early COD clients are paid D+N after delivery without waiting for the courier, with the Early COD fee", async () => {
    await db.insert(schema.earlyCodSubscriptions).values({ id: "ec1", orgId: A, status: "active", feeBps: 150, cycleDays: 2, termsVersion: 1 } as never);
    const p = (await po.payoutPreview(at("2026-11-21"), [A]))[0];
    expect(p).toMatchObject({ awaitingCourier: 1, shipments: [] }); // delivered 20 Nov: D+2 is 22 Nov
    const q = (await po.payoutPreview(at("2026-11-23"), [A]))[0];
    expect(q.shipments.map((x) => x.basis)).toEqual(["early"]);
    expect(q).toMatchObject({ grossPaise: 40_000, earlyFeePaise: 600, earlyGstPaise: 108, netPaise: 39_292 });
  });
});
