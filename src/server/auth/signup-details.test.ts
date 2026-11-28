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

const { createCustomerAccount, customerMobileTaken, signupLead } = await import("./accounts");
const { needsSignupDetails } = await import("./signup-details");
const { indianMobile, isDailyParcels } = await import("@/lib/signup-details");

beforeAll(async () => { await migrate(db, { migrationsFolder: "./migrations" }); });

describe("sign-up details (mobile, business, parcels per day)", () => {
  it("normalises Indian mobiles and checks the per-day choice", () => {
    expect(indianMobile("+91 98765 43210")).toBe("9876543210");
    expect(indianMobile("09876543210")).toBe("9876543210");
    expect(indianMobile("12345")).toBeNull();
    expect(indianMobile("5876543210")).toBeNull();
    expect(isDailyParcels("10 – 50 parcels")).toBe(true);
    expect(isDailyParcels("lots")).toBe(false);
  });

  it("email sign-up saves mobile (unverified), business and parcels per day, and creates a CRM lead linked to the account", async () => {
    const uid = await createCustomerAccount({ name: "Rahul Kumar", email: "rahul@shop.in", via: "email_otp", mobile: "9876500001", mobileVerified: false, businessName: "Rahul Fashion", dailyParcels: "10 – 50 parcels" });
    expect(uid).toBeTruthy();
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, uid!));
    const [o] = await db.select().from(schema.orgs).where(eq(schema.orgs.id, u.orgId!));
    expect(u.mobile).toBe("9876500001");
    expect(u.mobileVerifiedAt).toBeNull();
    expect(o.businessName).toBe("Rahul Fashion");
    expect(o.dailyParcels).toBe("10 – 50 parcels");
    expect(needsSignupDetails(u, o)).toBe(false);
    const [lead] = await db.select().from(schema.crmLeads).where(eq(schema.crmLeads.mobile, "9876500001"));
    expect(lead).toMatchObject({ source: "website", status: "new", company: "Rahul Fashion", orgId: u.orgId, volume: "Per day: 10 – 50 parcels" });
    expect(await customerMobileTaken("9876500001")).toBe(true);
    expect(await customerMobileTaken("9876500001", uid!)).toBe(false);
  });

  it("Google sign-up has no mobile → must fill /welcome/; a lead appears once they do", async () => {
    const uid = await createCustomerAccount({ name: "Asha G", email: "asha@gmail.com", googleSub: "g-asha", via: "google" });
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, uid!));
    const [o] = await db.select().from(schema.orgs).where(eq(schema.orgs.id, u.orgId!));
    expect(needsSignupDetails(u, o)).toBe(true);
    expect(await db.select().from(schema.crmLeads).where(eq(schema.crmLeads.email, "asha@gmail.com"))).toHaveLength(0);
    await signupLead(u.orgId!, { name: "Asha G", mobile: "9876500002", email: u.email, business: "Asha Crafts", dailyParcels: "1 – 10 parcels", via: "google" });
    const [lead] = await db.select().from(schema.crmLeads).where(eq(schema.crmLeads.mobile, "9876500002"));
    expect(lead.orgId).toBe(u.orgId);
  });

  it("mobile-OTP sign-up must still give business and parcels per day; old complete accounts are never stopped", () => {
    expect(needsSignupDetails({ mobile: "9876500003" }, { dailyParcels: null, profileCompletedAt: null })).toBe(true);
    expect(needsSignupDetails({ mobile: "9876500003" }, { dailyParcels: null, profileCompletedAt: new Date() })).toBe(false);
    expect(needsSignupDetails({ mobile: null }, { dailyParcels: "1 – 10 parcels", profileCompletedAt: new Date() })).toBe(true);
  });
});
