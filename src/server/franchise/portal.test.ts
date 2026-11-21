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
vi.mock("@/server/auth/session", () => ({
  revokeAllSessions: async (userId: string) => { await db.update(schema.sessions).set({ revokedAt: new Date() }).where(and(eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt))); },
}));

const svc = await import("./service");
const portal = await import("./portal");
const ref = await import("./referral");
const { createCustomerAccount } = await import("@/server/auth/accounts");
const ADMIN = "u_admin";
const base = { businessName: "Nagpur Movers", ownerName: "Asha Rao", mobile: "9876500002", email: "asha.fr@example.test", depositRupees: 0, monthlyTarget: 100, termStart: "2026-11-01", termEnd: "2027-10-31", pan: "ABCDE1234F", line1: "1 Main Rd", city: "Nagpur", state: "Maharashtra", pincode: "440001" };

async function makeActive(input = base, district = "Nagpur") {
  const id = await svc.createFranchise(ADMIN, input);
  await svc.addDistrict(ADMIN, id, "Maharashtra", district);
  await svc.setKycVerified(ADMIN, id, true);
  if ((await svc.currentTerms()).version === 0) await svc.publishTerms(ADMIN, "Franchise terms for tests. ".repeat(5));
  await svc.recordAgreement(ADMIN, id, "2026-11-02");
  await svc.setStatus(ADMIN, id, "active");
  return id;
}
async function orgOf(userId: string) {
  const [u] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
  const [o] = await db.select().from(schema.orgs).where(eq(schema.orgs.id, u.orgId!));
  return o;
}

let F = "", G = "", draft = "";
beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./migrations" });
  F = await makeActive();
  G = await makeActive({ ...base, businessName: "Wardha Couriers", email: "w.fr@example.test" }, "Wardha");
  draft = await svc.createFranchise(ADMIN, { ...base, businessName: "Draft Co", email: "d.fr@example.test" });
});

describe("referral attribution", () => {
  it("codes are normalised and only active franchises count", async () => {
    expect(ref.normalizeCode(" vsf-0001 ")).toBe("VSF-0001");
    expect(ref.normalizeCode("VSF-1; drop")).toBeNull();
    expect((await ref.activeFranchiseByCode("vsf-0001"))?.id).toBe(F);
    expect(await ref.activeFranchiseByCode("VSF-0003")).toBeNull(); // draft
  });

  it("sign-up with a code links the new customer; unknown/draft codes are ignored; sign-up never fails", async () => {
    const u1 = await createCustomerAccount({ name: "Ravi Traders", email: "ravi.t@example.test", via: "email_otp", referralCode: "VSF-0001" });
    const o1 = await orgOf(u1!);
    expect(o1).toMatchObject({ franchiseId: F, franchiseLinkSource: "referral" });
    const u2 = await createCustomerAccount({ name: "No Ref", email: "noref@example.test", via: "email_otp", referralCode: "VSF-0003" });
    expect((await orgOf(u2!)).franchiseId).toBeNull();
    const u3 = await createCustomerAccount({ name: "Junk", email: "junk@example.test", via: "google", googleSub: "g-1", referralCode: "<script>" });
    expect((await orgOf(u3!)).franchiseId).toBeNull();
  });

  it("an existing link is never replaced by a later referral", async () => {
    const u = await createCustomerAccount({ name: "Sticky", email: "sticky@example.test", via: "email_otp", referralCode: "VSF-0001" });
    const o = await orgOf(u!);
    expect(await ref.attributeReferral(o.id, "VSF-0002")).toBeNull();
    expect((await orgOf(u!)).franchiseId).toBe(F);
  });
});

describe("admin link / unlink", () => {
  it("links by email or mobile, refuses a customer of another franchise, and unlinks", async () => {
    const u = await createCustomerAccount({ name: "Walk In", email: "walkin@example.test", via: "email_otp" });
    await db.update(schema.users).set({ mobile: "9123456780" }).where(eq(schema.users.id, u!));
    expect(await portal.linkCustomer(ADMIN, G, "+91 91234 56780")).toBe("Walk In");
    await expect(portal.linkCustomer(ADMIN, F, "walkin@example.test")).rejects.toThrow(/with Wardha Couriers \(VSF-0002\)/);
    await expect(portal.linkCustomer(ADMIN, G, "nobody@example.test")).rejects.toThrow(/No customer/);
    await expect(portal.linkCustomer(ADMIN, draft, "noref@example.test")).rejects.toThrow(/active franchise/);
    const o = await orgOf(u!);
    await expect(portal.unlinkCustomer(ADMIN, F, o.id)).rejects.toThrow(/not with this franchise/);
    await portal.unlinkCustomer(ADMIN, G, o.id);
    expect((await orgOf(u!)).franchiseId).toBeNull();
  });
});

describe("dashboard data is scoped to the franchise", () => {
  it("customers, shipments, value and wallet", async () => {
    const [mine] = await portal.franchiseCustomers(F);
    const org = mine.orgId;
    await db.update(schema.wallets).set({ postedPaise: 150_000, reservedPaise: 20_000 }).where(eq(schema.wallets.orgId, org));
    await db.insert(schema.orders).values({ id: "ord_1", orgId: org, orderNumber: "A1", mode: "B2C", paymentType: "cod", declaredValuePaise: 50_000, consignee: { city: "Pune", pincode: "411001" } });
    const ship = (id: string, status: string, booking: string, sell: number) => ({ id, orgId: org, orderId: "ord_1", providerAccountId: "pa", provider: "internal_x", carrierCode: "dl", carrierName: "Delhivery Surface", serviceName: "Surface", bookingStatus: booking, status, quoteId: "q", sellPaise: sell, costPaise: 1, chargeableWeightGrams: 500 });
    await db.insert(schema.shipments).values([ship("sh_1", "delivered", "confirmed", 11_800), ship("sh_2", "in_transit", "confirmed", 9_000), ship("sh_3", "cancelled", "cancelled", 5_000)]);
    const sum = await portal.franchiseSummary(F);
    expect(sum.customers).toBe(2);
    expect(sum.shipmentsMonth).toBe(2);
    expect(sum.valueMonthPaise).toBe(20_800);
    expect(sum.deliveredMonth).toBe(1);
    expect(sum.walletPaise).toBe(130_000);
    const rows = await portal.franchiseShipments(F);
    expect(rows.map((r) => r.id).sort()).toEqual(["sh_1", "sh_2", "sh_3"]);
    expect(Object.keys(rows[0])).not.toContain("costPaise");
    expect(Object.keys(rows[0])).not.toContain("provider");
    expect(rows[0].city).toBe("Pune");
    // another franchise sees none of it
    expect(await portal.franchiseShipments(G)).toHaveLength(0);
    expect(await portal.franchiseCustomer(G, org)).toBeNull();
    expect((await portal.franchiseCustomer(F, org))?.id).toBe(org);
  });

  it("month starts at IST midnight", () => {
    expect(portal.monthStartIst(new Date("2026-11-30T20:00:00Z")).toISOString()).toBe("2026-11-30T18:30:00.000Z"); // 1 Dec IST
    expect(portal.monthStartIst(new Date("2026-11-21T10:00:00Z")).toISOString()).toBe("2026-10-31T18:30:00.000Z");
  });
});

describe("franchise login", () => {
  it("set-password link works once; a new link replaces the old; termination closes everything", async () => {
    const { token } = await portal.issueLoginLink(ADMIN, F);
    const f1 = await svc.getFranchise(F);
    expect(f1?.userId).toBeTruthy();
    expect(await portal.loginState(f1!)).toMatchObject({ state: "invited" });
    await expect(portal.consumeSetupToken(token, "short")).rejects.toThrow(/10 characters/);
    expect(await portal.consumeSetupToken(token, "long-enough-pass")).toBe(f1!.userId);
    await expect(portal.consumeSetupToken(token, "long-enough-pass")).rejects.toThrow(/invalid|expired|used/);
    expect((await portal.loginState(f1!)).state).toBe("ready");
    expect((await portal.franchiseForUser(f1!.userId!))?.id).toBe(F);

    const again = await portal.issueLoginLink(ADMIN, F);
    const old = await portal.issueLoginLink(ADMIN, F); // replaces `again`
    await expect(portal.consumeSetupToken(again.token, "another-password")).rejects.toThrow(/invalid|expired/);
    expect(await portal.consumeSetupToken(old.token, "another-password")).toBe(f1!.userId);
    await expect(portal.consumeSetupToken("made-up-token", "another-password")).rejects.toThrow(/invalid/);

    // email change on the record follows to the login
    await svc.updateFranchise(ADMIN, F, { ...base, email: "asha.new@example.test" });
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, f1!.userId!));
    expect(u.email).toBe("asha.new@example.test");

    await svc.setStatus(ADMIN, F, "suspended", "Review of brand use");
    expect((await portal.franchiseForUser(f1!.userId!))?.status).toBe("suspended"); // can still see data
    expect(await ref.activeFranchiseByCode("VSF-0001")).toBeNull(); // referral paused
    await svc.setStatus(ADMIN, F, "terminated", "Ended by notice");
    expect(await portal.franchiseForUser(f1!.userId!)).toBeNull();
    const [u2] = await db.select().from(schema.users).where(eq(schema.users.id, f1!.userId!));
    expect(u2.active).toBe(false);
    expect(await portal.franchiseCustomers(F)).toHaveLength(0); // customers continue with Vishwaship directly
    await expect(portal.issueLoginLink(ADMIN, F)).rejects.toThrow(/terminated/);
  });
});
