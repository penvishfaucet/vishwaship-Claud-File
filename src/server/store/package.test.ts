import { beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { eq } from "drizzle-orm";
import * as schema from "@/server/db/schema";
import { defaultTheme } from "@/lib/store-themes";

const client = new PGlite();
const db = drizzle(client, { schema });
const feature = { on: true };
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/client", () => ({ getDb: async () => db, schema }));
vi.mock("@/server/auth/session", () => ({ readSession: async () => null }));
vi.mock("@/server/features", () => ({ hasFeature: async () => feature.on }));

const pkg = await import("./package");

const A = "org_pk_a", B = "org_pk_b";
// two tiny but real images
const JPG = Buffer.from("/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=", "base64");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

const theme = () => {
  const t = defaultTheme("minimal") as unknown as { logo: string | null; sections: Array<{ type: string; settings: Record<string, string> }> };
  t.logo = "file:banners/logo.png";
  t.sections.find((s) => s.type === "hero")!.settings.image = "file:banners/hero.jpg";
  return t;
};
const manifest = (over: Record<string, unknown> = {}) => ({
  format: "vishwaship-store-package", version: 1,
  store: { name: "Penvish Test", slug: "penvish-test", tagline: "Apno Ki Pasand", about: "About us", seo: { title: "T", description: "D" } },
  theme: { themeKey: "minimal", config: theme() },
  categories: ["Basin Mixers"],
  products: [
    { sku: "QUB001", title: "Qubix Bib Cock", priceRupees: 626, compareRupees: 1252, category: "Bib Cocks", stock: 50, weightGrams: 500, hsn: "8481", taxPercent: 18, images: ["img/a.jpg"] },
    { sku: "PNV021", title: "Ornamix Single Lever Basin Mixer", priceRupees: 2341, compareRupees: 4682, category: "Basin Mixers", stock: 50, weightGrams: 500, hsn: "8481", taxPercent: 18, featured: true, images: ["img/a.jpg"] },
  ],
  ...over,
});
const files = { "img/a.jpg": JPG, "banners/hero.jpg": JPG, "banners/logo.png": PNG };

beforeAll(async () => {
  await migrate(db, { migrationsFolder: "./migrations" });
  await db.insert(schema.orgs).values([{ id: A, name: A, businessName: "Penvish Bath Fittings" }, { id: B, name: B, businessName: "Other" }]);
  await db.insert(schema.users).values({ id: "u_pk", kind: "customer", orgId: A, name: "P", email: "owner@penvish.test", mobile: "9876500000" });
});

describe("store package import", () => {
  it("finds the customer by org id, email or mobile", async () => {
    expect(await pkg.resolveCustomer(A)).toBe(A);
    expect(await pkg.resolveCustomer("OWNER@penvish.test".toLowerCase())).toBe(A);
    expect(await pkg.resolveCustomer("+91 98765 00000")).toBe(A);
    expect(await pkg.resolveCustomer("nobody@x.test")).toBeNull();
  });

  it("rejects a bad manifest and customers without Online Store", async () => {
    await expect(pkg.startPackageImport(A, "s1", { format: "zip" })).rejects.toThrow(/not valid/);
    await expect(pkg.startPackageImport(A, "s1", manifest({ products: [{ title: "X", priceRupees: 10, images: ["../../etc/passwd.jpg"] }] }))).rejects.toThrow(/not valid/);
    feature.on = false;
    await expect(pkg.startPackageImport(A, "s1", manifest())).rejects.toThrow(/not switched on/);
    feature.on = true;
  });

  it("creates the store, reuses identical images, applies products/categories/theme draft, and a second run only updates", async () => {
    const st = await pkg.startPackageImport(A, "s1", manifest());
    expect(st).toMatchObject({ created: true, slug: "penvish-test" });
    expect(st.files.sort()).toEqual(Object.keys(files).sort());
    await expect(pkg.uploadPackageMedia(A, [{ name: "img/x.txt", data: JPG }])).rejects.toThrow(/Bad image path/);
    await expect(pkg.uploadPackageMedia(A, [{ name: "img/x.jpg", data: Buffer.from("not an image") }])).rejects.toThrow(/not a JPG/);
    const media = await pkg.uploadPackageMedia(A, Object.entries(files).map(([name, data]) => ({ name, data })));
    expect(media["img/a.jpg"]).toBe(media["banners/hero.jpg"]); // same bytes → one stored image
    expect(Object.keys(await pkg.uploadPackageMedia(A, [{ name: "img/a.jpg", data: JPG }]))).toHaveLength(1);
    const [{ n: mediaCount }] = await db.execute(`select count(*)::int as n from store_media`).then((r) => (r as unknown as { rows: Array<{ n: number }> }).rows);
    expect(mediaCount).toBe(2);

    await expect(pkg.applyPackage(A, "s1", manifest(), { "img/a.jpg": media["img/a.jpg"] })).rejects.toThrow(/not uploaded/);
    const r1 = await pkg.applyPackage(A, "s1", manifest(), media);
    expect(r1).toMatchObject({ created: 2, updated: 0, categoriesAdded: 2, theme: "minimal", errorCount: 0 });
    const [s] = await db.select().from(schema.stores).where(eq(schema.stores.orgId, A));
    expect(s.publishedTheme).toBeNull(); // nothing is published by the import
    expect(s.status).toBe("draft");
    const draft = s.draftTheme as { logo: string; sections: Array<{ type: string; settings: Record<string, string> }> };
    expect(draft.logo).toBe(media["banners/logo.png"]);
    expect(draft.sections.find((x) => x.type === "hero")!.settings.image).toBe(media["banners/hero.jpg"]);
    expect((s.settings as { tagline: string }).tagline).toBe("Apno Ki Pasand");

    const r2 = await pkg.applyPackage(A, "s1", manifest({ store: { name: "Penvish Test", tagline: "Changed", about: "", seo: {} } }), media);
    expect(r2).toMatchObject({ created: 0, updated: 2, categoriesAdded: 0 });
    const prods = await db.select().from(schema.storeProducts).where(eq(schema.storeProducts.storeId, s.id));
    expect(prods).toHaveLength(2);
    expect(prods.find((p) => p.sku === "PNV021")).toMatchObject({ pricePaise: 234_100, comparePaise: 468_200, featured: true, taxBps: 1800, hsn: "8481", stock: 50 });
    const [s2] = await db.select().from(schema.stores).where(eq(schema.stores.orgId, A));
    expect((s2.settings as { tagline: string }).tagline).toBe("Apno Ki Pasand"); // filled texts are not overwritten
  });

  it("refuses images that belong to another store", async () => {
    await pkg.startPackageImport(B, "s1", manifest({ store: { name: "Other Store", slug: "other-pk" } }));
    const mine = await pkg.uploadPackageMedia(A, [{ name: "img/a.jpg", data: JPG }]);
    const other = await pkg.uploadPackageMedia(B, [{ name: "banners/logo.png", data: PNG }, { name: "banners/hero.jpg", data: JPG }]);
    await expect(pkg.applyPackage(B, "s1", manifest(), { ...other, "img/a.jpg": mine["img/a.jpg"] })).rejects.toThrow(/do not belong/);
  });
});
