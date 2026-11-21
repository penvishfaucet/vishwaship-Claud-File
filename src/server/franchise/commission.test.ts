import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq, isNull } from "drizzle-orm";
import * as schema from "@/server/db/schema";

// Real SQL on in-memory PGlite.
const client = new PGlite();
const db = drizzle(client, { schema });
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getDb: async () => db, schema }));
vi.mock("@/server/auth/session", () => ({ revokeAllSessions: async () => {} }));

const svc = await import("./service");
const portal = await import("./portal");
const c = await import("./commission");
const ADMIN = "u_admin", FUSER = "u_fr";
const base = { businessName: "Indore Express", ownerName: "Neha Jain", mobile: "9876500003", email: "neha.fr@example.test", depositRupees: 0, monthlyTarget: 0, termStart: "2026-01-01", termEnd: "2027-12-31", pan: "ABCDE1234F", line1: "2 MG Rd", city: "Indore", state: "Madhya Pradesh", pincode: "452001" };
let F = "", ORG = "", ORG2 = "";

async function delivered(id: string, org: string, eligible: number, bps: number, at: Date, status = "delivered", booking = "confirmed", createdAt = new Date(at.getTime() - 3 * 86400_000)) {
  await db.insert(schema.quotes).values({ id: `q_${id}`, orgId: org, provider: "x", carrierCode: "dl", serviceName: "Surface", mode: "B2C", request: {}, priced: { eligibleCostPreTax: eligible, markup: { bps } }, totalPaise: 1, expiresAt: at });
  await db.insert(schema.orders).values({ id: `o_${id}`, orgId: org, orderNumber: id, mode: "B2C", paymentType: "prepaid", declaredValuePaise: 1, consignee: {} });
  await db.insert(schema.shipments).values({ id, orgId: org, orderId: `o_${id}`, providerAccountId: "pa", provider: "x", carrierCode: "dl", carrierName: "Delhivery", serviceName: "Surface", bookingStatus: booking, status, quoteId: `q_${id}`, sellPaise: 1, costPaise: 1, chargeableWeightGrams: 500, deliveredAt: status.endsWith("delivered") ? at : null, createdAt });
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./migrations" });
  F = await svc.createFranchise(ADMIN, base);
  await svc.addDistrict(ADMIN, F, "Madhya Pradesh", "Indore");
  await svc.setKycVerified(ADMIN, F, true);
  await svc.publishTerms(ADMIN, "Franchise terms for tests. ".repeat(5));
  await svc.recordAgreement(ADMIN, F, "2026-01-02");
  await svc.setStatus(ADMIN, F, "active");
  await db.update(schema.franchises).set({ userId: FUSER }).where(eq(schema.franchises.id, F));
  for (const [id, mob] of [["org_c1", "9000000001"], ["org_c2", "9000000002"]]) {
    await db.insert(schema.orgs).values({ id, name: id, businessName: id === "org_c1" ? "Asha Sarees" : "Ravi Tools", createdAt: new Date("2026-01-01T00:00:00Z") });
    await db.insert(schema.users).values({ id: `u_${id}`, kind: "customer", orgId: id, name: id, email: `${id}@example.test`, mobile: mob });
    await db.insert(schema.wallets).values({ id: `w_${id}`, orgId: id });
  }
  ORG = "org_c1"; ORG2 = "org_c2";
});

describe("pure helpers", () => {
  it("commission = cost × (customer − base), never negative; periods in IST", () => {
    expect(c.commissionFor(10_000, 3000, 1500)).toBe(1500); // ₹100 cost, 30% vs 15% → ₹15
    expect(c.commissionFor(10_001, 2500, 1000)).toBe(1500);
    expect(c.commissionFor(10_000, 1000, 1500)).toBe(0);
    expect(c.periodOf(new Date("2026-11-30T19:00:00Z"))).toBe("2026-12"); // 00:30 IST 1 Dec
    expect(c.lastClosedPeriod(new Date("2026-01-10T00:00:00Z"))).toBe("2025-12");
    expect(c.pctText(1250)).toBe("12.5%");
  });
});

describe("settings and customer prices", () => {
  it("admin limits are validated", async () => {
    await expect(c.saveCommissionSettings(ADMIN, F, { basePct: 15, minPct: 10, maxPct: 40 })).rejects.toThrow(/minimum must be at least the base/);
    await expect(c.saveCommissionSettings(ADMIN, F, { basePct: 15, minPct: 20, maxPct: 18 })).rejects.toThrow(/maximum/);
    await expect(c.saveCommissionSettings(ADMIN, F, { basePct: 15, minPct: 20, maxPct: 40, defaultPct: 50 })).rejects.toThrow(/Default/);
    await expect(c.saveCommissionSettings(ADMIN, F, { basePct: 15, minPct: 20, maxPct: 40, accountLast4: "123456" })).rejects.toThrow(/last 4/);
    await c.saveCommissionSettings(ADMIN, F, { basePct: 15, minPct: 18, maxPct: 40, defaultPct: 25, accountName: "Indore Express", accountLast4: "4321", ifsc: "hdfc0001234" });
    const f = await svc.getFranchise(F);
    expect(f).toMatchObject({ baseMarkupBps: 1500, minCustomerBps: 1800, maxCustomerBps: 4000, defaultCustomerBps: 2500, payoutIfsc: "HDFC0001234" });
    expect(f?.commissionFrom).toBeTruthy();
    // backdate the start so the test shipments count
    await db.update(schema.franchises).set({ commissionFrom: new Date("2026-01-01T00:00:00Z") }).where(eq(schema.franchises.id, F));
  });

  it("linking a customer applies the default price; the franchise can change it only within range", async () => {
    await portal.linkCustomer(ADMIN, F, "org_c1@example.test");
    await portal.linkCustomer(ADMIN, F, "9000000002");
    await db.update(schema.orgs).set({ franchiseLinkedAt: new Date("2026-01-01T00:00:00Z") }).where(eq(schema.orgs.franchiseId, F));
    let prices = await c.customerPrices(F);
    expect(prices.map((p) => p.bps)).toEqual([2500, 2500]);
    const f = (await svc.getFranchise(F))!;
    await expect(c.setCustomerPrice(FUSER, f, ORG, 50)).rejects.toThrow(/between 18% and 40%/);
    await expect(c.setCustomerPrice(FUSER, f, "org_other", 20)).rejects.toThrow(/not found/);
    await c.setCustomerPrice(FUSER, f, ORG, 30);
    await c.setCustomerPrice(FUSER, f, ORG2, null); // back to Vishwaship standard
    prices = await c.customerPrices(F);
    expect(prices.find((p) => p.orgId === ORG)?.bps).toBe(3000);
    expect(prices.find((p) => p.orgId === ORG2)?.bps).toBeNull();
    // stored as the normal versioned customer markup rule, one live row
    const live = await db.select().from(schema.markupRules).where(and(eq(schema.markupRules.orgId, ORG), isNull(schema.markupRules.clearedAt)));
    expect(live).toHaveLength(1);
    expect(live[0]).toMatchObject({ provider: "*", bps: 3000, version: 2 });
  });
});

describe("accrual", () => {
  it("only delivered, non-cancelled shipments booked after joining; once per shipment", async () => {
    await delivered("sh_a", ORG, 10_000, 3000, new Date("2026-10-15T06:00:00Z"));
    await delivered("sh_b", ORG2, 20_000, 2500, new Date("2026-10-20T06:00:00Z"));
    await delivered("sh_rto", ORG, 10_000, 3000, new Date("2026-10-21T06:00:00Z"), "rto_delivered");
    await delivered("sh_cxl", ORG, 10_000, 3000, new Date("2026-10-21T06:00:00Z"), "delivered", "cancelled");
    await delivered("sh_transit", ORG, 10_000, 3000, new Date("2026-10-21T06:00:00Z"), "in_transit");
    await delivered("sh_old", ORG, 10_000, 3000, new Date("2025-12-20T06:00:00Z"), "delivered", "confirmed", new Date("2025-12-15T00:00:00Z")); // before joining
    await delivered("sh_nov", ORG, 5_000, 3000, new Date("2026-11-02T06:00:00Z"));
    expect(await c.accrueCommissions(F)).toBe(3);
    expect(await c.accrueCommissions(F)).toBe(0);
    const lines = await c.commissionLines(F);
    const by = Object.fromEntries(lines.map((l) => [l.c.shipmentId, l.c]));
    expect(by.sh_a).toMatchObject({ amountPaise: 1500, period: "2026-10", customerBps: 3000, baseBps: 1500 });
    expect(by.sh_b.amountPaise).toBe(2000);
    expect(by.sh_nov).toMatchObject({ amountPaise: 750, period: "2026-11" });
    const months = await c.commissionByPeriod(F);
    expect(months.map((m) => [m.period, m.earnedPaise])).toEqual([["2026-11", 750], ["2026-10", 3500]]);
  });
});

describe("payouts", () => {
  const NOW = new Date("2026-11-21T06:00:00Z");
  it("statement for a closed month: gross, TDS, adjustment, approve, paid", async () => {
    await expect(c.generatePayouts(ADMIN, "2026-11", NOW)).rejects.toThrow(/ended/);
    await c.savePayoutConfig(ADMIN, 2);
    expect(await c.generatePayouts(ADMIN, "2026-10", NOW)).toBe(1);
    expect(await c.generatePayouts(ADMIN, "2026-10", NOW)).toBe(0); // nothing left for October
    let [p] = (await c.payoutsList({ franchiseId: F })).map((r) => r.p);
    expect(p).toMatchObject({ period: "2026-10", shipments: 2, grossPaise: 3500, tdsBps: 200, tdsPaise: 70, netPaise: 3430, status: "draft" });
    expect((await c.commissionLines(F, { payoutId: p.id })).length).toBe(2);
    await expect(c.markPayoutPaid(ADMIN, p.id, "UTR12345678", "2026-11-20")).rejects.toThrow(/Approve/);
    await expect(c.adjustPayout(ADMIN, p.id, -100, "too big")).rejects.toThrow(/below zero/);
    await c.adjustPayout(ADMIN, p.id, -10, "Branding kit");
    await c.approvePayout(ADMIN, p.id);
    await expect(c.adjustPayout(ADMIN, p.id, 0, "")).rejects.toThrow(/draft/);
    await expect(c.markPayoutPaid(ADMIN, p.id, "x", "2026-11-20")).rejects.toThrow(/UTR/);
    await c.markPayoutPaid(ADMIN, p.id, "UTR12345678", "2026-11-20");
    [p] = (await c.payoutsList({ franchiseId: F })).map((r) => r.p);
    expect(p).toMatchObject({ status: "paid", netPaise: 2430, adjustmentPaise: -1000, utr: "UTR12345678" });
    expect((await c.commissionLines(F, { payoutId: p.id })).every((l) => l.c.status === "paid")).toBe(true);
  });

  it("late lines roll into the next statement; cancel returns lines; suspended franchise cannot be approved", async () => {
    await delivered("sh_late", ORG, 10_000, 3000, new Date("2026-10-31T10:00:00Z")); // October, accrued after October was paid
    await c.accrueCommissions(F);
    const DEC = new Date("2026-12-05T06:00:00Z");
    expect(await c.generatePayouts(ADMIN, "2026-11", DEC)).toBe(1);
    const nov = (await c.payoutsList({ franchiseId: F, period: "2026-11" }))[0].p;
    expect(nov).toMatchObject({ shipments: 2, grossPaise: 2250 });
    await expect(c.cancelPayout(ADMIN, nov.id, "x")).rejects.toThrow(/reason/);
    await c.cancelPayout(ADMIN, nov.id, "Recheck numbers");
    expect((await c.commissionLines(F)).filter((l) => l.c.status === "earned")).toHaveLength(2);
    expect(await c.generatePayouts(ADMIN, "2026-11", DEC)).toBe(1); // a new live statement after the cancelled one
    const again = (await c.payoutsList({ franchiseId: F, period: "2026-11" })).find((r) => r.p.status === "draft")!.p;
    await svc.setStatus(ADMIN, F, "suspended", "Review of brand use");
    await expect(c.approvePayout(ADMIN, again.id)).rejects.toThrow(/on hold/);
    // a suspended franchise cannot change prices either
    await expect(c.setCustomerPrice(FUSER, (await svc.getFranchise(F))!, ORG, 20)).rejects.toThrow(/active/);
  });

  it("void only for unpaid lines not in a statement", async () => {
    await delivered("sh_v", ORG, 10_000, 3000, new Date("2026-12-02T06:00:00Z"));
    await c.accrueCommissions(F);
    const line = (await c.commissionLines(F)).find((l) => l.c.shipmentId === "sh_v")!;
    await c.voidCommission(ADMIN, line.c.id, "Customer disputed weight");
    const paid = (await c.commissionLines(F)).find((l) => l.c.shipmentId === "sh_a")!;
    await expect(c.voidCommission(ADMIN, paid.c.id, "Not allowed now")).rejects.toThrow(/not in a payout/);
  });
});
