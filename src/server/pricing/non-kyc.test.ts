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
const Q = await import("@/server/quotes/service");

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./migrations" });
  await db.insert(schema.orgs).values([{ id: "o_new", name: "N", businessName: "New Co", kycStatus: "not_started" }, { id: "o_ok", name: "K", businessName: "KYC Co", kycStatus: "approved" }]);
  await db.insert(schema.markupRules).values({ id: "mr_ok", provider: "*", orgId: "o_ok", bps: 1000, version: 1, effectiveFrom: new Date(0) });
});

describe("margin for accounts without approved KYC", () => {
  it("30 % by default on every courier and service; the account's own margin applies after KYC approval", async () => {
    expect(await Q.effectiveMarkup("shipmozo", "B2C", "o_new")).toMatchObject({ bps: 3000, source: "non_kyc" });
    expect(await Q.effectiveMarkup("delhivery_b2b", "B2B", "o_new")).toMatchObject({ bps: 3000, source: "non_kyc" });
    expect(await Q.effectiveMarkup("shipmozo", "B2C", "o_ok")).toMatchObject({ bps: 1000, source: "customer_override" });
    await db.update(schema.orgs).set({ kycStatus: "approved" }).where(eq(schema.orgs.id, "o_new"));
    expect((await Q.effectiveMarkup("shipmozo", "B2C", "o_new")).source).not.toBe("non_kyc");
    await db.update(schema.orgs).set({ kycStatus: "pending" }).where(eq(schema.orgs.id, "o_new"));
  });
  it("a customer rate Admin activates applies before KYC approval (KYC is needed to book, not to see the rates)", async () => {
    await db.insert(schema.orgs).values({ id: "o_rate", name: "R", businessName: "Rate Co", kycStatus: "not_started" });
    expect((await Q.effectiveMarkup("shipmozo", "B2C", "o_rate")).source).toBe("non_kyc");
    await db.insert(schema.markupRules).values({ id: "mr_rate", provider: "*", orgId: "o_rate", bps: 1500, version: 1, effectiveFrom: new Date(0) });
    expect(await Q.nonKycRule("o_rate")).toBeNull();
    expect(await Q.effectiveMarkup("shipmozo", "B2C", "o_rate")).toMatchObject({ bps: 1500, source: "customer_override" });
  });
  it("Admin can change the percentage or switch the rule off; the public calculator is never affected", async () => {
    await db.insert(schema.pricingSettings).values({ key: "non_kyc_markup", value: { enabled: true, bps: 4000 } });
    expect((await Q.nonKycRule("o_new"))?.bps).toBe(4000);
    await db.update(schema.pricingSettings).set({ value: { enabled: false, bps: 4000 } }).where(eq(schema.pricingSettings.key, "non_kyc_markup"));
    expect(await Q.nonKycRule("o_new")).toBeNull();
    expect(await Q.nonKycRule(null)).toBeNull();
  });
});
