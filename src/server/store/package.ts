import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { ThemeConfig, readSettings, themeByKey } from "@/lib/store-themes";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db/client";
import { hasFeature } from "@/server/features";
import { newId } from "@/server/util/ids";
import { MEDIA_MAX_BYTES, ProductInput, StoreError, addCategory, saveProduct } from "./catalog";
import { createStore, storeForOrg } from "./service";

/**
 * Store package import (Admin → Online Stores → Import package): a folder with manifest.json plus images that
 * sets up a merchant's store in one go — categories, products with photos, a theme DRAFT with banners, and store
 * texts. Used to build a catalogue site for a customer (e.g. from their PDF catalogue) and load it into their account.
 * Safe to run again: products are matched by SKU + name and updated; identical images are reused, not duplicated.
 * Nothing is published: the merchant (or staff) reviews the draft and publishes.
 */
const FileRef = z.string().regex(/^(?!.*\.\.)[A-Za-z0-9_\-/]{1,120}\.(jpe?g|png|webp)$/i, "Bad image path");
const PackageProduct = z.object({
  sku: z.string().trim().max(60).default(""),
  title: z.string().trim().min(2).max(140),
  slug: z.string().trim().max(80).default(""),
  description: z.string().max(5000).default(""),
  priceRupees: z.number().positive().max(10_00_000),
  compareRupees: z.number().min(0).max(10_00_000).nullable().default(null),
  category: z.string().trim().max(60).default(""),
  stock: z.number().int().min(0).max(1_000_000).default(0),
  weightGrams: z.number().int().min(1).max(100_000).default(500),
  hsn: z.string().trim().regex(/^$|^\d{4,8}$/).default(""),
  taxPercent: z.number().default(0),
  featured: z.boolean().default(false),
  images: z.array(FileRef).max(8).default([]),
});
export const PackageManifest = z.object({
  format: z.literal("vishwaship-store-package"),
  version: z.literal(1),
  store: z.object({
    name: z.string().trim().min(2).max(80),
    slug: z.string().trim().max(40).default(""),
    tagline: z.string().max(140).default(""),
    about: z.string().max(5000).default(""),
    seo: z.object({ title: z.string().max(70).default(""), description: z.string().max(160).default("") }).default({}),
  }),
  theme: z.object({ themeKey: z.string().max(40), config: z.unknown() }).nullable().default(null),
  categories: z.array(z.string().trim().min(2).max(60)).max(50).default([]),
  products: z.array(PackageProduct).max(2000),
});
export type PackageManifest = z.infer<typeof PackageManifest>;

/** Every image path the package uses (products, logo, theme sections). */
export function packageFiles(m: PackageManifest): string[] {
  const set = new Set<string>();
  for (const p of m.products) for (const f of p.images) set.add(f);
  const walk = (v: unknown) => {
    if (typeof v === "string" && v.startsWith("file:")) set.add(v.slice(5));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(m.theme?.config);
  return [...set];
}

async function needStore(orgId: string) {
  const s = await storeForOrg(orgId);
  if (!s) throw new StoreError("Start the import first");
  return s;
}

/** Step 1: check the package and make sure the customer has a store (created as a draft when missing). */
export async function startPackageImport(orgId: string, staffId: string, raw: unknown, slugOverride?: string) {
  const parsed = PackageManifest.safeParse(raw);
  if (!parsed.success) throw new StoreError(`manifest.json is not valid: ${parsed.error.issues[0]?.path.join(".")} ${parsed.error.issues[0]?.message}`);
  const m = parsed.data;
  const db = await getDb();
  const [org] = await db.select({ id: schema.orgs.id, name: schema.orgs.businessName }).from(schema.orgs).where(eq(schema.orgs.id, orgId));
  if (!org) throw new StoreError("Customer not found");
  if (!(await hasFeature(orgId, "online_store"))) throw new StoreError("Online Store is not switched on for this customer. Turn it on in Plans & Features first.");
  let store = await storeForOrg(orgId);
  let created = false;
  if (!store) {
    const r = await createStore(orgId, { name: m.store.name, slug: (slugOverride || m.store.slug).toLowerCase() });
    if (!r.ok) throw new StoreError(`Could not create the store: ${r.message}`);
    store = r.store; created = true;
  }
  await audit({ actorUserId: staffId, actorKind: "staff", orgId, action: "store.package_start", targetType: "store", targetId: store.id, details: { products: m.products.length, created } });
  return { storeId: store.id, slug: store.slug, created, files: packageFiles(m), products: m.products.length, customer: org.name };
}

const sniff = (b: Buffer) =>
  b[0] === 0xff && b[1] === 0xd8 ? "image/jpeg"
    : b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? "image/png"
    : b.length > 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP" ? "image/webp" : null;

/** Step 2 (repeated in batches): store images; an image already in this store (same bytes) is reused. */
export async function uploadPackageMedia(orgId: string, files: Array<{ name: string; data: Buffer }>) {
  const s = await needStore(orgId);
  const db = await getDb();
  const out: Record<string, string> = {};
  for (const f of files) {
    if (!FileRef.safeParse(f.name).success) throw new StoreError(`Bad image path: ${f.name}`);
    if (f.data.length > MEDIA_MAX_BYTES) throw new StoreError(`${f.name} is larger than 1.5 MB`);
    const mime = sniff(f.data);
    if (!mime) throw new StoreError(`${f.name} is not a JPG, PNG or WebP image`);
    const same = await db.select({ id: schema.storeMedia.id, data: schema.storeMedia.data }).from(schema.storeMedia)
      .where(and(eq(schema.storeMedia.storeId, s.id), eq(schema.storeMedia.sizeBytes, f.data.length)));
    const hit = same.find((x) => Buffer.from(x.data as Uint8Array).equals(f.data));
    if (hit) { out[f.name] = hit.id; continue; }
    const id = newId("sm", 20);
    await db.insert(schema.storeMedia).values({ id, storeId: s.id, orgId, mime, sizeBytes: f.data.length, data: f.data });
    out[f.name] = id;
  }
  return out;
}

const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

/** Step 3: create/update categories and products, write the theme draft and fill empty store texts. */
export async function applyPackage(orgId: string, staffId: string, raw: unknown, media: Record<string, string>) {
  const m = PackageManifest.parse(raw);
  const s = await needStore(orgId);
  const db = await getDb();
  const ids = [...new Set(Object.values(media))];
  if (ids.length) {
    const own = await db.select({ id: schema.storeMedia.id }).from(schema.storeMedia).where(and(eq(schema.storeMedia.storeId, s.id), inArray(schema.storeMedia.id, ids)));
    if (own.length !== ids.length) throw new StoreError("Some images do not belong to this store. Run the import again.");
  }
  const need = packageFiles(m).filter((f) => !media[f]);
  if (need.length) throw new StoreError(`${need.length} images were not uploaded (first: ${need[0]})`);

  // categories (matched by name, case-insensitive)
  const cats = await db.select().from(schema.storeCategories).where(eq(schema.storeCategories.storeId, s.id));
  const catId = new Map(cats.map((c) => [c.name.toLowerCase(), c.id]));
  const wanted = [...new Set([...m.categories, ...m.products.map((p) => p.category).filter(Boolean)])];
  let categoriesAdded = 0;
  for (const name of wanted) if (!catId.has(name.toLowerCase())) { catId.set(name.toLowerCase(), await addCategory(orgId, name)); categoriesAdded++; }

  // products: matched by SKU + name (both stored as given) so a second run updates instead of duplicating
  const existing = await db.select({ id: schema.storeProducts.id, sku: schema.storeProducts.sku, title: schema.storeProducts.title }).from(schema.storeProducts).where(eq(schema.storeProducts.storeId, s.id)).orderBy(schema.storeProducts.createdAt);
  const keyOf = (sku: string | null, title: string) => `${(sku ?? "").toLowerCase()}|${title.trim().toLowerCase()}`;
  const byKey = new Map<string, string>();
  for (const p of existing) if (!byKey.has(keyOf(p.sku, p.title))) byKey.set(keyOf(p.sku, p.title), p.id);
  let created = 0, updated = 0;
  const errors: string[] = [];
  for (const p of m.products) {
    const slug = slugify(p.slug || p.title);
    const input = ProductInput.safeParse({
      title: p.title, slug, description: p.description, priceRupees: p.priceRupees, compareRupees: p.compareRupees && p.compareRupees > p.priceRupees ? p.compareRupees : null,
      categoryId: p.category ? catId.get(p.category.toLowerCase()) ?? null : null, images: p.images.map((f) => media[f]), stock: p.stock, weightGrams: p.weightGrams,
      status: "active", featured: p.featured, sku: p.sku, hsn: p.hsn, taxPercent: p.taxPercent,
    });
    if (!input.success) { errors.push(`${p.title}: ${input.error.issues[0]?.message}`); continue; }
    const id = byKey.get(keyOf(p.sku, p.title));
    try {
      const r = await saveProduct(orgId, input.data, id);
      if (id) updated++; else { created++; byKey.set(keyOf(p.sku, p.title), r.id); }
    } catch (e) { errors.push(`${p.title}: ${(e as Error).message}`); }
  }

  // theme draft: "file:<path>" values become this store's media ids
  let theme: string | null = null;
  if (m.theme) {
    const swap = (v: unknown): unknown => typeof v === "string" && v.startsWith("file:") ? media[v.slice(5)] : Array.isArray(v) ? v.map(swap) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, swap(x)])) : v;
    const cfg = ThemeConfig.safeParse(swap(m.theme.config));
    if (!cfg.success) errors.push(`Theme: ${cfg.error.issues[0]?.path.join(".")} ${cfg.error.issues[0]?.message}`);
    else {
      const key = themeByKey(m.theme.themeKey).key;
      // staff import may set any theme, including one locked as a custom design
      await db.update(schema.stores).set({ themeKey: key, draftTheme: cfg.data, updatedAt: new Date() }).where(eq(schema.stores.id, s.id));
      theme = key;
    }
  }

  // store texts: only where still empty
  const st = readSettings(s.settings);
  await db.update(schema.stores).set({
    settings: { ...st, tagline: st.tagline || m.store.tagline, about: st.about || m.store.about, seo: { title: st.seo.title || m.store.seo.title, description: st.seo.description || m.store.seo.description } },
    updatedAt: new Date(),
  }).where(eq(schema.stores.id, s.id));

  const result = { created, updated, categoriesAdded, theme, errors: errors.slice(0, 20), errorCount: errors.length };
  await audit({ actorUserId: staffId, actorKind: "staff", orgId, action: "store.package_apply", targetType: "store", targetId: s.id, details: { ...result, errors: undefined } });
  return result;
}

/** Find the customer by organisation id, login email or mobile (admin form). */
export async function resolveCustomer(ref: string) {
  const v = ref.trim();
  const db = await getDb();
  if (/^org_[A-Za-z0-9_]+$/.test(v)) { const [o] = await db.select({ id: schema.orgs.id }).from(schema.orgs).where(eq(schema.orgs.id, v)); return o?.id ?? null; }
  const mobile = v.replace(/\D/g, "").slice(-10);
  const [u] = await db.select({ orgId: schema.users.orgId }).from(schema.users)
    .where(and(eq(schema.users.kind, "customer"), v.includes("@") ? eq(schema.users.email, v.toLowerCase()) : eq(schema.users.mobile, mobile)));
  return u?.orgId ?? null;
}
