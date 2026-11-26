import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/server/db/schema";

const client = new PGlite();
const db = drizzle(client, { schema });
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getDb: async () => db, schema }));
vi.mock("@/server/features", () => ({ hasFeature: async () => true }));
const { buyerBranding } = await import("./pages");

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./migrations" });
  await db.insert(schema.orgs).values([{ id: "plain", name: "Asha Crafts", businessName: "Asha Crafts" }, { id: "branded", name: "Brand Co", businessName: "Brand Co" }]);
  await db.insert(schema.users).values({ id: "u1", kind: "customer", orgId: "plain", name: "Asha", email: "asha@example.in", mobile: "9876543210" });
  await db.insert(schema.trackingPages).values({ orgId: "branded", slug: "brand-co", isPublished: true, draft: {},
    published: { businessName: "Brand Co Official", logo: "", primaryColor: "#111111", accentColor: "#222222", headline: "Where is my order", message: "", supportEmail: "help@brand.co", supportPhone: "+91 90000 00000", supportHours: "", showCarrier: true, footerText: "" } });
});

describe("shared tracking link branding", () => {
  it("seller without a branded page: their business name, mobile and email", async () => {
    const b = await buyerBranding("plain");
    expect(b).toMatchObject({ businessName: "Asha Crafts", supportPhone: "+91 98765 43210", supportEmail: "asha@example.in" });
  });
  it("seller with a published branded page: that page's settings", async () => {
    expect(await buyerBranding("branded")).toMatchObject({ businessName: "Brand Co Official", supportEmail: "help@brand.co" });
  });
  it("unknown org: nothing", async () => {
    expect(await buyerBranding("nope")).toBeNull();
  });
});
