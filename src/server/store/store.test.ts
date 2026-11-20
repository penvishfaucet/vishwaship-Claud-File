import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import { THEMES, ThemeConfig, defaultTheme, readSettings, readTheme } from "@/lib/store-themes";

// Real SQL on in-memory PGlite. The session is faked per test via `currentSession`.
const client = new PGlite();
const db = drizzle(client, { schema });
let currentSession: { orgId: string } | null = null;
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getDb: async () => db, schema }));
vi.mock("@/server/auth/session", () => ({ readSession: async () => currentSession }));

const svc = await import("./service");
const cat = await import("./catalog");
const dom = await import("./domains");
const pub = await import("./public");

const A = "org_store_a", B = "org_store_b";
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a0b00000000049454e44ae426082", "hex");

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./migrations" });
  await db.insert(schema.orgs).values([{ id: A, name: "A", businessName: "Store A" }, { id: B, name: "B", businessName: "Store B" }]);
});

describe("themes", () => {
  it("every built-in theme is a valid config and falls back on bad data", () => {
    for (const t of THEMES) expect(ThemeConfig.safeParse(t.config).success).toBe(true);
    expect(readTheme({ colors: "nope" }, "minimal")).toEqual(defaultTheme("minimal"));
    expect(readSettings(null).checkout.codEnabled).toBe(true);
  });
});

describe("store lifecycle", () => {
  it("validates store links: format, reserved words, uniqueness", async () => {
    expect(await svc.slugProblem("ab")).toMatch(/3-40/);
    expect(await svc.slugProblem("demo")).toMatch(/reserved/);
    expect(await svc.slugProblem("-bad-")).toBeTruthy();
    const r = await svc.createStore(A, { name: "Asha Crafts", slug: "asha-crafts" });
    expect(r.ok).toBe(true);
    expect(await svc.slugProblem("asha-crafts")).toMatch(/taken/);
    expect((await svc.createStore(B, { name: "Copy", slug: "asha-crafts" })).ok).toBe(false);
    expect((await svc.createStore(A, { name: "Second", slug: "second-one" })).ok).toBe(false); // one store per org
    expect((await svc.createStore(B, { name: "Bina Store", slug: "bina-store" })).ok).toBe(true);
  });

  it("draft store is hidden from buyers; owner preview works only for the same org", async () => {
    expect(await pub.loadStorefront("asha-crafts")).toBeNull();
    currentSession = { orgId: B };
    expect(await pub.loadStorefront("asha-crafts", { preview: true })).toBeNull();
    currentSession = { orgId: A };
    const sf = await pub.loadStorefront("asha-crafts", { preview: true });
    expect(sf?.preview).toBe(true);
    expect(sf?.indexable).toBe(false);
    currentSession = null;
  });

  it("catalog is isolated per org (ids from another org are rejected)", async () => {
    const img = await cat.uploadMedia(A, PNG);
    await expect(cat.uploadMedia(A, Buffer.from("GIF89a-not-allowed"))).rejects.toThrow(/PNG, JPG or WebP/);
    const catId = await cat.addCategory(A, "Sarees");
    const base = { title: "Silk Saree", slug: "", description: "Pure silk", priceRupees: 1499, compareRupees: 1999, categoryId: catId, images: [img], stock: 3, weightGrams: 600, status: "active" as const, featured: true, seoTitle: "", seoDescription: "" };
    const p = await cat.saveProduct(A, base);
    expect(p.slug).toBe("silk-saree");
    expect((await cat.saveProduct(A, base)).slug).toBe("silk-saree-2");
    // org B cannot use A's image, category or product
    await expect(cat.saveProduct(B, { ...base, categoryId: null })).rejects.toThrow(/Image not found/);
    await expect(cat.saveProduct(B, { ...base, images: [] })).rejects.toThrow(/Category not found/);
    await expect(cat.saveProduct(B, { ...base, images: [], categoryId: null }, p.id)).rejects.toThrow(/Product not found/);
    expect(await cat.getProduct(B, p.id)).toBeNull();
    await expect(cat.saveProduct(A, { ...base, compareRupees: 100 })).rejects.toThrow(/Compare-at/);
    // theme draft cannot reference another store's image
    expect((await svc.saveDraftTheme(B, "bazaar", { ...defaultTheme(), logo: img }).catch((e: Error) => ({ ok: false, message: e.message }))).ok).toBe(false);
  });

  it("publish needs the launch checklist, keeps versions, and restore copies into the draft", async () => {
    const blocked = await svc.publishStore(A, "u1");
    expect(blocked.ok).toBe(false);
    const [w] = await db.insert(schema.warehouses).values({ id: "wh_a", orgId: A, label: "Main", contactName: "A", mobile: "9999999999", line1: "x", pincode: "110001", city: "Delhi", state: "Delhi" }).returning();
    expect((await svc.saveSettings(B, { checkout: { ...readSettings({}).checkout, warehouseId: w.id } })).ok).toBe(false); // B can't use A's warehouse
    await svc.saveSettings(A, { contact: { email: "a@example.com", phone: "", whatsapp: "", address: "" }, policies: { shipping: "s", refund: "r", privacy: "p", terms: "t" }, checkout: { ...readSettings({}).checkout, warehouseId: w.id } });
    const v1 = await svc.publishStore(A, "u1");
    expect(v1).toMatchObject({ ok: true, version: 1 });
    const live = await pub.loadStorefront("asha-crafts");
    expect(live?.indexable).toBe(true);
    expect(live?.products.map((x) => x.slug)).toContain("silk-saree");
    // change draft colour, publish v2, restore v1 into draft
    await svc.saveDraftTheme(A, "bazaar", { ...defaultTheme(), colors: { ...defaultTheme().colors, primary: "#000000" } });
    expect((await pub.loadStorefront("asha-crafts"))?.theme.colors.primary).toBe(defaultTheme().colors.primary); // live unchanged until publish
    expect((await svc.publishStore(A, "u1")).ok).toBe(true);
    const versions = await svc.themeVersions(A);
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    expect((await svc.restoreVersion(B, versions[1].id)).ok).toBe(false);
    expect((await svc.restoreVersion(A, versions[1].id)).ok).toBe(true);
    const [s] = await db.select().from(schema.stores).where(eq(schema.stores.orgId, A));
    expect((s.draftTheme as ThemeConfig).colors.primary).toBe(defaultTheme().colors.primary);
  });
});

describe("custom domains", () => {
  it("normalises, rejects platform hosts, keeps hostnames unique across stores", async () => {
    expect(dom.normaliseHost("HTTPS://Shop.Example.com/path")).toBe("shop.example.com");
    expect(dom.isApex("example.com")).toBe(true);
    expect(dom.isApex("shop.example.com")).toBe(false);
    expect(dom.isApex("brand.co.in")).toBe(true);
    expect((await dom.addDomain(A, "x.vishwaship.in")).ok).toBe(false);
    expect((await dom.addDomain(A, "not a domain")).ok).toBe(false);
    const r = await dom.addDomain(A, "shop.asha.example");
    expect(r.ok).toBe(true);
    expect((await dom.addDomain(B, "SHOP.asha.example")).ok).toBe(false);
  });

  it("verifies by TXT record, needs routing record, and never claims SSL", async () => {
    const [d] = await dom.listDomains(A);
    const fake = (txt: string[][], cname: string[]) => ({ txt: async () => txt, cname: async () => cname, a: async () => [] as string[] });
    expect((await dom.verifyDomain(B, d.id, fake([], []))).ok).toBe(false); // other org
    let r = await dom.verifyDomain(A, d.id, fake([["wrong"]], []));
    expect(r).toMatchObject({ ok: true, owned: false });
    expect((await dom.setPrimary(A, d.id)).ok).toBe(false); // must be verified first
    r = await dom.verifyDomain(A, d.id, fake([[dom.TXT_VALUE(d.verifyToken)]], ["stores.vishwaship.in."]));
    expect(r).toMatchObject({ owned: true, pointed: true });
    const [after] = await dom.listDomains(A);
    expect(after.status).toBe("verified");
    expect(after.sslStatus).toBe("pending_setup");
    expect(await dom.storeByHost("shop.asha.example")).toBeTruthy();
    expect((await dom.disconnectDomain(B, d.id)).ok).toBe(false);
    expect((await dom.disconnectDomain(A, d.id)).ok).toBe(true);
    expect(await dom.storeByHost("shop.asha.example")).toBeNull();
  });
});
