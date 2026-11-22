import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { and, eq } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import { defaultTheme, readSettings } from "@/lib/store-themes";

// Real SQL on in-memory PGlite. Pixel / ad-account checks are faked as connected so the checklist can complete.
const client = new PGlite();
const db = drizzle(client, { schema });
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getDb: async () => db, schema }));
vi.mock("@/server/auth/session", () => ({ readSession: async () => null }));
vi.mock("./marketing", async (orig) => ({ ...(await orig<typeof import("./marketing")>()), marketing: async () => ({ codMilestone: "confirmed", meta: { pixelId: "1234567890", tokenEnc: null, tokenHint: null, testEventCode: "", check: { ok: true, state: "connected", message: "", at: "" } } }) }));
vi.mock("./meta-connect", async (orig) => ({ ...(await orig<typeof import("./meta-connect")>()), metaConnection: async () => ({ verified: { adAccount: "2026-01-01" } }) }));

const b = await import("./billing");
const co = await import("./checkout");
const { planState } = await import("@/lib/store-plan");

const A = "org_bl_a", B = "org_bl_b";
const merchant = { userId: "u_merchant", kind: "customer" as const };
const staff = { userId: "u_staff", kind: "staff" as const };
const DAY = 86400_000;

async function walletPaise(org: string) {
  const [w] = await db.select().from(schema.wallets).where(eq(schema.wallets.orgId, org));
  return w.postedPaise - w.reservedPaise;
}
async function ledger(org: string, kind: string) {
  const [w] = await db.select().from(schema.wallets).where(eq(schema.wallets.orgId, org));
  return db.select().from(schema.ledgerEntries).where(and(eq(schema.ledgerEntries.walletId, w.id), eq(schema.ledgerEntries.kind, kind)));
}

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./migrations" });
  for (const o of [A, B]) {
    await db.insert(schema.orgs).values({ id: o, name: o, businessName: o });
    await db.insert(schema.wallets).values({ id: `w_${o}`, orgId: o, postedPaise: 0 });
  }
  await db.insert(schema.users).values({ id: "u_staff", kind: "staff", name: "Neha Staff", email: "staff@example.test", staffRole: "operations" });
  const settings = readSettings({ checkout: { codEnabled: true, warehouseId: "wh_x" } });
  await db.insert(schema.stores).values({ id: "st_bl", orgId: A, name: "Bill Store", slug: "bill-store", status: "live", draftTheme: defaultTheme(), publishedTheme: defaultTheme(), settings, trialEndsAt: new Date(Date.now() + 5 * DAY) });
  await db.insert(schema.stores).values({ id: "st_blx", orgId: B, name: "Expired", slug: "expired-store", status: "live", draftTheme: defaultTheme(), publishedTheme: defaultTheme(), settings, trialEndsAt: new Date(Date.now() - DAY) });
});

describe("trial and plan state", () => {
  it("trial, paid and expired; a paid period wins; no trial date counts as trial", () => {
    const now = new Date("2026-11-21T10:00:00Z");
    expect(planState({ trialEndsAt: new Date(now.getTime() + 3 * DAY), paidUntil: null }, now)).toMatchObject({ state: "trial", daysLeft: 3, ordersOpen: true });
    expect(planState({ trialEndsAt: new Date(now.getTime() - DAY), paidUntil: null }, now)).toMatchObject({ state: "expired", ordersOpen: false });
    expect(planState({ trialEndsAt: new Date(now.getTime() - DAY), paidUntil: new Date(now.getTime() + 30 * DAY) }, now)).toMatchObject({ state: "active", ordersOpen: true });
    expect(planState({ trialEndsAt: null, paidUntil: null }, now).ordersOpen).toBe(true);
  });

  it("an expired store takes no new orders (quote and place), with the 'reopen soon' message", async () => {
    await expect(co.liveStore("expired-store")).rejects.toThrow(/not available right now/); // every public store API
    const s = await co.liveStore("expired-store", { allowExpired: true }); // finishing an existing order
    expect(() => co.assertOrdersOpen(s)).toThrow(/reopen soon/);
    await expect(co.placeOrder("expired-store", co.CheckoutInput.parse({
      checkoutKey: "ck_expired_0123456789", lines: [{ productId: "p_x", variantId: null, qty: 1 }], paymentMethod: "cod", coupon: "",
      buyer: { name: "Ravi Kumar", mobile: "9876543210", email: "", line1: "12 MG Road", line2: "", pincode: "110001", city: "New Delhi", state: "Delhi" },
    }))).rejects.toThrow(/reopen soon/);
  });

  it("buying a plan needs balance, charges once per key, and starts after the running trial", async () => {
    await db.update(schema.storePlans).set({ active: true }).where(eq(schema.storePlans.id, "spl_monthly")); // plans are off by default (Growth Package); Admin can switch one on
    await expect(b.buyPlan(B, merchant, "spl_monthly", "idem-plan-0001")).rejects.toThrow(/Not enough wallet balance/);
    await db.update(schema.wallets).set({ postedPaise: 400_000 }).where(eq(schema.wallets.orgId, A));
    const [store] = await db.select().from(schema.stores).where(eq(schema.stores.id, "st_bl"));
    const r1 = await b.buyPlan(A, merchant, "spl_monthly", "idem-plan-0002");
    const r2 = await b.buyPlan(A, merchant, "spl_monthly", "idem-plan-0002");
    expect(r2.replayed).toBe(true);
    expect(r2.sub.id).toBe(r1.sub.id);
    expect(await walletPaise(A)).toBe(400_000 - 294_882); // Rs 2,499 + 18% GST
    expect((await ledger(A, "store_plan")).length).toBe(1);
    expect(r1.sub.periodStart.getTime()).toBe(store.trialEndsAt!.getTime()); // trial days are kept
    expect([r1.sub.basePaise, r1.sub.gstPaise, r1.sub.amountPaise]).toEqual([249_900, 44_982, 294_882]);
    expect(r1.sub.receiptNumber).toMatch(/^VSP-\d{4}-[0-9A-F]{10}$/);
    const [after] = await db.select().from(schema.stores).where(eq(schema.stores.id, "st_bl"));
    expect(after.paidUntil!.getTime()).toBe(r1.sub.periodEnd.getTime());
    expect(planState(after).state).toBe("active");
  });
});

describe("managed Meta Ads: terms, deposit, refund", () => {
  it("deposit needs the current terms; is held once with its own ledger entry and receipt", async () => {
    await expect(b.payDeposit(A, merchant, "idem-dep-0001")).rejects.toThrow(/Accept the Managed Ads terms/);
    await expect(b.acceptTerms(A, merchant, 99, 30000)).rejects.toThrow(/updated/);
    await expect(b.acceptTerms(A, merchant, 2, 20000)).rejects.toThrow(/at least ₹30,000/); // ₹1,000 a day minimum
    await b.acceptTerms(A, merchant, 2, 30000);
    await db.update(schema.wallets).set({ postedPaise: 600_000 }).where(eq(schema.wallets.orgId, A));
    const r = await b.payDeposit(A, merchant, "idem-dep-0002");
    expect(r.dep.status).toBe("held");
    expect(r.dep.amountPaise).toBe(294_882); // Rs 2,499 + GST
    const [st] = await db.select().from(schema.stores).where(eq(schema.stores.id, "st_bl"));
    expect(st.paidUntil!.getTime()).toBe(b.DEPOSIT_OPEN_UNTIL.getTime()); // the deposit keeps the store open
    expect(r.dep.receiptNumber).toMatch(/^VSD-/);
    expect((await b.payDeposit(A, merchant, "idem-dep-0002")).replayed).toBe(true);
    await expect(b.payDeposit(A, merchant, "idem-dep-0003")).rejects.toThrow(/already held/);
    expect(await walletPaise(A)).toBe(600_000 - 294_882);
    const led = await ledger(A, "store_deposit");
    expect(led.length).toBe(1);
    expect(led[0].amountPaise).toBe(-294_882);
  });

  it("service starts only from staff with a complete checklist; merchants can't tick staff items", async () => {
    await expect(b.setAdsStatus(A, merchant, "active")).rejects.toThrow(/account manager/);
    await expect(b.setAdsStatus(A, staff, "active")).rejects.toThrow(/Not ready/);
    await expect(b.setChecklistItem(A, merchant, "partner_verified", true)).rejects.toThrow(/automatically/);
    await b.setChecklistItem(A, merchant, "partner_added", true);
    await b.setChecklistItem(A, merchant, "payment_method", true);
    await b.setChecklistItem(A, staff, "partner_verified", true);
    await b.setAdsStatus(A, staff, "active");
    expect((await b.managedAdsRow("st_bl"))!.status).toBe("active");
  });

  it("spend changes need explicit merchant approval, within the monthly limit; tenant-scoped", async () => {
    await expect(b.proposeChange("u_staff", "st_bl", b.ChangeInput.parse({ kind: "new_campaign", campaignName: "Diwali" }))).rejects.toThrow(/budget/);
    await expect(b.proposeChange("u_staff", "st_bl", b.ChangeInput.parse({ kind: "new_campaign", campaignName: "Diwali", dailyBudgetRupees: 1100 }))).rejects.toThrow(/monthly ad spend limit/);
    const id = await b.proposeChange("u_staff", "st_bl", b.ChangeInput.parse({ kind: "new_campaign", campaignName: "Diwali", dailyBudgetRupees: 500 }));
    await expect(b.staffChangeAction("u_staff", id, "applied")).rejects.toThrow(/merchant-approved/);
    await expect(b.decideChange(B, merchant, id, true, true, "")).rejects.toThrow(/Create your store|not found/);
    await expect(b.decideChange(A, merchant, id, true, false, "")).rejects.toThrow(/confirm/);
    await b.decideChange(A, merchant, id, true, true, "ok");
    await expect(b.decideChange(A, merchant, id, false, false, "")).rejects.toThrow(/already decided/);
    await b.staffChangeAction("u_staff", id, "applied", "120200000000001");
    const pause = await b.proposeChange("u_staff", "st_bl", b.ChangeInput.parse({ kind: "pause", campaignName: "Diwali" }));
    const rows = await b.adChanges("st_bl");
    expect(rows.find((r) => r.id === id)).toMatchObject({ status: "applied", needsApproval: true, decidedBy: "u_merchant", metaCampaignId: "120200000000001" });
    expect(rows.find((r) => r.id === pause)).toMatchObject({ status: "applied", needsApproval: false });
  });

  it("refund: only after the service ends; deductions need a note; approved refund credits the wallet once", async () => {
    await expect(b.requestDepositRefund(A, merchant, "closing")).rejects.toThrow(/End Managed Meta Ads first/);
    const open = await b.proposeChange("u_staff", "st_bl", b.ChangeInput.parse({ kind: "budget_increase", campaignName: "Diwali", dailyBudgetRupees: 600 }));
    await b.setAdsStatus(A, merchant, "ended");
    expect((await b.adChanges("st_bl")).find((r) => r.id === open)!.status).toBe("withdrawn"); // nothing can go live after the end
    await expect(b.requestDepositRefund(A, merchant, "closing")).rejects.toThrow(/3-month minimum term/);
    await db.update(schema.storeDeposits).set({ createdAt: new Date(Date.now() - 91 * 86400_000) }).where(eq(schema.storeDeposits.storeId, "st_bl"));
    await b.requestDepositRefund(A, merchant, "closing");
    const dep = (await b.activeDeposit("st_bl"))!;
    expect(dep.status).toBe("refund_requested");
    await expect(b.decideDepositRefund("u_staff", dep.id, false, 0, "")).rejects.toThrow(/Write why/);
    await expect(b.decideDepositRefund("u_staff", dep.id, true, 200_000, "")).rejects.toThrow(/Explain the deduction/);
    await expect(b.decideDepositRefund("u_staff", dep.id, true, 300_000, "")).rejects.toThrow(/between/);
    const before = await walletPaise(A);
    await b.decideDepositRefund("u_staff", dep.id, true, 200_000, "₹948.82 unpaid service dues");
    const [closed] = await db.select().from(schema.stores).where(eq(schema.stores.id, "st_bl"));
    expect(closed.paidUntil!.getTime()).toBeLessThanOrEqual(Date.now()); // no deposit: the store stops taking new orders
    await expect(b.decideDepositRefund("u_staff", dep.id, true, 200_000, "again")).rejects.toThrow(/no open refund/);
    expect(await walletPaise(A)).toBe(before + 200_000);
    const refunds = await ledger(A, "store_deposit_refund");
    expect(refunds.length).toBe(1);
    const [d] = await db.select().from(schema.storeDeposits).where(eq(schema.storeDeposits.id, dep.id));
    expect(d).toMatchObject({ status: "refunded", refundPaise: 200_000, decisionNote: "₹948.82 unpaid service dues" });
    expect(await b.activeDeposit("st_bl")).toBeNull();
  });

  it("terms change bumps the version and is audited", async () => {
    const cfg = await b.saveBillingConfig("u_staff", { trialDays: 15, depositRupees: 5000, terms: `${b.DEFAULT_TERMS}\n6. New rule.`, refundDays: 7, disabledThemes: [] });
    expect(cfg.termsVersion).toBe(3);
    const same = await b.saveBillingConfig("u_staff", { trialDays: 20, depositRupees: 5000, terms: cfg.terms, refundDays: 7, disabledThemes: ["minimal"] });
    expect(same.termsVersion).toBe(3);
    const logs = await db.select().from(schema.auditLog).where(eq(schema.auditLog.action, "store.billing_config"));
    expect(logs.length).toBe(2);
  });
});
