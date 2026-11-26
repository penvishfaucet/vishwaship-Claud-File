import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/server/db/schema";

const client = new PGlite();
const db = drizzle(client, { schema });
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getDb: async () => db, schema }));
// the demo service stands in for Shipora X here
vi.mock("@/server/quotes/restricted", async (orig) => ({ ...(await orig<typeof import("./restricted")>()), RESTRICTED_ADAPTERS: ["demo"] }));

const { getQuotes } = await import("./service");
const { setShiporaAccess, shiporaOrgIds } = await import("./restricted");
const { createRateLink, deleteRateLink, getRateLink, listRateLinks, updateRateLink } = await import("@/server/franchise-rates/links");

const req = { mode: "B2C" as const, originPincode: "122001", destinationPincode: "110001", paymentType: "prepaid" as const, codAmount: 0, declaredValue: 100000, packages: [{ count: 1, lengthMm: 220, breadthMm: 100, heightMm: 100, actualWeightGrams: 500 }] };
const sees = async (orgId: string | null, includeRestricted = false) => (await getQuotes(req, orgId, { persist: false, includeRestricted })).offers.length > 0;

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./migrations" });
  await db.insert(schema.orgs).values([{ id: "org_bulk", name: "Bulk", businessName: "Bulk Co" }, { id: "org_std", name: "Std", businessName: "Std Co" }]);
  await db.insert(schema.providerAccounts).values({ id: "pa_demo", adapter: "demo", category: "shipping", label: "Demo", mode: "test", status: "enabled", configPublic: {} });
});

describe("restricted courier service (Shipora X)", () => {
  it("is off for every customer and the public until switched on", async () => {
    expect(await sees("org_bulk")).toBe(false);
    expect(await sees("org_std")).toBe(false);
    expect(await sees(null)).toBe(false);
  });

  it("switched on for one customer: only that customer sees it", async () => {
    await setShiporaAccess("org_bulk", true);
    expect(await shiporaOrgIds()).toEqual(["org_bulk"]);
    expect(await sees("org_bulk")).toBe(true);
    expect(await sees("org_std")).toBe(false);
    expect(await sees(null)).toBe(false);
    await setShiporaAccess("org_bulk", false);
    expect(await sees("org_bulk")).toBe(false);
  });

  it("a personal rate link with Shipora X on includes it", async () => {
    expect(await sees(null, true)).toBe(true);
  });
});

describe("personal franchise rate links", () => {
  it("create, find, switch Shipora X, delete", async () => {
    const l = await createRateLink("Maa Ganga Super Collection", false);
    expect(l.id).toMatch(/^maa-ganga-super-collection-[0-9a-f]{8}$/);
    expect((await getRateLink(l.id))?.firm).toBe("Maa Ganga Super Collection");
    expect(await getRateLink("maa-ganga-super-collection-00000000")).toBeNull();
    expect(await getRateLink("../etc")).toBeNull();
    await updateRateLink(l.id, { shipora: true });
    expect((await getRateLink(l.id))?.shipora).toBe(true);
    await deleteRateLink(l.id);
    expect(await listRateLinks()).toEqual([]);
  });
});
