import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "@/server/db/schema";

const client = new PGlite();
const db = drizzle(client, { schema });
const ctx = { session: { userId: "u1", email: "a@b.in", name: "A", impersonatorId: null }, org: { id: "o1", kycStatus: "not_submitted" } };
const enqueued: unknown[] = [];
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getDb: async () => db, schema }));
vi.mock("@/server/portal/context", () => ({ portalContext: async () => ctx }));
vi.mock("@/server/audit", () => ({ audit: async () => {} }));
vi.mock("@/server/jobs/runner", () => ({ enqueue: async (...a: unknown[]) => { enqueued.push(a); } }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
const { saveProfile } = await import("./onboarding-actions");

const form = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const good = { name: "Ravi Kumar", mobile: "98765 43210", business: "Ravi Traders", gstin: "", volume: "0 – 100", line1: "12 Main Road", line2: "Near Temple", pincode: "249402", city: "Haridwar", state: "Uttarakhand" };

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./migrations" });
  await db.insert(schema.orgs).values({ id: "o1", name: "Ravi", businessName: "Ravi" });
  await db.insert(schema.users).values({ id: "u1", kind: "customer", orgId: "o1", name: "Ravi", email: "a@b.in", googleSub: "g1" });
});

describe("Complete Your Profile (e.g. after Google signup)", () => {
  it("needs a mobile number", async () => {
    expect(await saveProfile(undefined, form({ ...good, mobile: "" }))).toMatchObject({ field: "mobile" });
  });
  it("saves mobile, name and address, and the address becomes the default pickup address", async () => {
    await expect(saveProfile(undefined, form(good))).rejects.toThrow("REDIRECT /portal/kyc/");
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, "u1"));
    expect(u.mobile).toBe("9876543210");
    const whs = await db.select().from(schema.warehouses).where(eq(schema.warehouses.orgId, "o1"));
    expect(whs).toHaveLength(1);
    expect(whs[0]).toMatchObject({ contactName: "Ravi Kumar", mobile: "9876543210", line1: "12 Main Road", pincode: "249402", city: "Haridwar", state: "Uttarakhand", isDefault: true, active: true });
    expect(enqueued).toHaveLength(1);
  });
  it("saving the profile again does not add a second pickup address", async () => {
    await expect(saveProfile(undefined, form({ ...good, line1: "New Address 5" }))).rejects.toThrow("REDIRECT");
    expect(await db.select().from(schema.warehouses).where(eq(schema.warehouses.orgId, "o1"))).toHaveLength(1);
  });
});
