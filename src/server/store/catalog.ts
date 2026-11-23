import "server-only";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/server/db/client";
import { newId, randomToken } from "@/server/util/ids";
import { sniffUpload } from "@/server/storage";
import { slugify } from "@/lib/store-themes";
import { markStep, storeForOrg } from "./service";
import { move } from "./stock";

/** Catalog: products (optionally with variants), categories, coupons and store images. All scoped by the session org. */

export const VariantInput = z.object({
  id: z.string().max(60).nullable().default(null),
  values: z.array(z.string().trim().min(1, "Fill every option value").max(40)).min(1).max(3),
  sku: z.string().trim().max(60).default(""),
  priceRupees: z.number().positive("Variant price must be more than 0").max(10_00_000),
  compareRupees: z.number().min(0).max(10_00_000).nullable().default(null),
  stock: z.number().int().min(0).max(1_000_000),
  weightGrams: z.number().int().min(1).max(100_000).nullable().default(null),
});

export const ProductInput = z.object({
  title: z.string().trim().min(2, "Enter a product name").max(140),
  slug: z.string().trim().max(80).optional().default(""),
  description: z.string().max(5000).default(""),
  priceRupees: z.number().positive("Price must be more than 0").max(10_00_000),
  compareRupees: z.number().min(0).max(10_00_000).nullable().default(null),
  categoryId: z.string().max(60).nullable().default(null),
  images: z.array(z.string().regex(/^sm_[A-Za-z0-9]{8,40}$/)).max(8).default([]),
  stock: z.number().int().min(0).max(1_000_000),
  weightGrams: z.number().int().min(1).max(100_000),
  status: z.enum(["draft", "active", "archived"]),
  featured: z.boolean().default(false),
  seoTitle: z.string().max(70).default(""),
  seoDescription: z.string().max(160).default(""),
  sku: z.string().trim().max(60).default(""),
  hsn: z.string().trim().regex(/^$|^\d{4,8}$/, "HSN code is 4 to 8 digits").default(""),
  taxPercent: z.number().refine((v) => [0, 0.25, 3, 5, 12, 18, 28].includes(v), "Choose a GST rate").default(0),
  lowStockAt: z.number().int().min(0).max(100_000).default(5),
  lengthCm: z.number().min(0).max(500).default(0),
  breadthCm: z.number().min(0).max(500).default(0),
  heightCm: z.number().min(0).max(500).default(0),
  options: z.array(z.string().trim().min(1, "Name every option").max(30)).max(3).default([]),
  variants: z.array(VariantInput).max(100).default([]),
  /** Cost per piece (owner 2026-11-23). productRupees = purchase cost (no variants only; null = leave as it is). */
  costs: z.object({
    productRupees: z.number().min(0).max(10_00_000).nullable().default(null),
    packagingRupees: z.number().min(0).max(1_00_000).default(0), labourRupees: z.number().min(0).max(1_00_000).default(0),
    otherRupees: z.number().min(0).max(1_00_000).default(0), overheadRupees: z.number().min(0).max(1_00_000).default(0),
  }).optional(),
}).superRefine((v, ctx) => {
  if (v.options.length && !v.variants.length) ctx.addIssue({ code: "custom", path: ["variants"], message: "Add at least one variant" });
  if (!v.options.length && v.variants.length) ctx.addIssue({ code: "custom", path: ["options"], message: "Name the option (e.g. Size) for your variants" });
  if (new Set(v.options.map((o) => o.toLowerCase())).size !== v.options.length) ctx.addIssue({ code: "custom", path: ["options"], message: "Option names must be different" });
  const seen = new Set<string>();
  v.variants.forEach((x, i) => {
    if (x.values.length !== v.options.length) ctx.addIssue({ code: "custom", path: ["variants", i], message: "Each variant needs a value for every option" });
    const k = x.values.map((s) => s.toLowerCase()).join("|");
    if (seen.has(k)) ctx.addIssue({ code: "custom", path: ["variants", i], message: `Variant "${x.values.join(" / ")}" is listed twice` });
    seen.add(k);
  });
});
export type ProductInput = z.infer<typeof ProductInput>;

const toPaise = (r: number) => Math.round(r * 100);

async function requireStore(orgId: string) {
  const s = await storeForOrg(orgId);
  if (!s) throw new StoreError("Create your store first");
  return s;
}
export class StoreError extends Error {}

export async function listProducts(orgId: string, f: { q?: string; status?: string; categoryId?: string } = {}) {
  const s = await requireStore(orgId);
  const db = await getDb();
  const conds = [eq(schema.storeProducts.storeId, s.id)];
  if (f.status && ["draft", "active", "archived"].includes(f.status)) conds.push(eq(schema.storeProducts.status, f.status));
  if (f.categoryId) conds.push(eq(schema.storeProducts.categoryId, f.categoryId));
  if (f.q) conds.push(or(ilike(schema.storeProducts.title, `%${f.q.replace(/[%_]/g, "")}%`), ilike(schema.storeProducts.slug, `%${f.q.replace(/[%_]/g, "")}%`))!);
  return db.select().from(schema.storeProducts).where(and(...conds)).orderBy(desc(schema.storeProducts.updatedAt)).limit(500);
}

export async function getProduct(orgId: string, id: string) {
  const s = await requireStore(orgId);
  const db = await getDb();
  const [p] = await db.select().from(schema.storeProducts).where(and(eq(schema.storeProducts.id, id), eq(schema.storeProducts.storeId, s.id)));
  return p ?? null;
}

async function uniqueSlug(storeId: string, base: string, exceptId?: string) {
  const db = await getDb();
  const root = slugify(base) || `item-${randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, "")}`;
  for (let i = 0; i < 50; i++) {
    const cand = i === 0 ? root : `${root.slice(0, 74)}-${i + 1}`;
    const [hit] = await db.select({ id: schema.storeProducts.id }).from(schema.storeProducts)
      .where(and(eq(schema.storeProducts.storeId, storeId), eq(schema.storeProducts.slug, cand)));
    if (!hit || hit.id === exceptId) return cand;
  }
  return `${root.slice(0, 60)}-${Date.now().toString(36)}`;
}

export async function saveProduct(orgId: string, input: ProductInput, id?: string) {
  const s = await requireStore(orgId);
  const db = await getDb();
  if (input.categoryId) {
    const [c] = await db.select({ id: schema.storeCategories.id }).from(schema.storeCategories)
      .where(and(eq(schema.storeCategories.id, input.categoryId), eq(schema.storeCategories.storeId, s.id)));
    if (!c) throw new StoreError("Category not found");
  }
  if (input.images.length) {
    const rows = await db.select({ id: schema.storeMedia.id }).from(schema.storeMedia)
      .where(and(eq(schema.storeMedia.storeId, s.id), inArray(schema.storeMedia.id, input.images)));
    if (rows.length !== new Set(input.images).size) throw new StoreError("Image not found");
  }
  if (input.compareRupees !== null && input.compareRupees > 0 && input.compareRupees <= input.priceRupees) throw new StoreError("Compare-at price must be more than the price");
  const slug = await uniqueSlug(s.id, input.slug || input.title, id);
  for (const v of input.variants) if (v.compareRupees && v.compareRupees <= v.priceRupees) throw new StoreError(`Compare-at price of ${v.values.join(" / ")} must be more than its price`);
  const hasVariants = input.options.length > 0;
  const values = {
    title: input.title, slug, description: input.description || null,
    // with variants, the product price/stock mirror the cheapest variant / total stock (lists, sorting, SEO)
    pricePaise: hasVariants ? Math.min(...input.variants.map((v) => toPaise(v.priceRupees))) : toPaise(input.priceRupees),
    comparePaise: !hasVariants && input.compareRupees ? toPaise(input.compareRupees) : null, categoryId: input.categoryId, images: input.images,
    stock: hasVariants ? input.variants.reduce((n, v) => n + v.stock, 0) : input.stock, weightGrams: input.weightGrams, status: input.status, featured: input.featured,
    seo: { title: input.seoTitle, description: input.seoDescription }, sku: input.sku || null, hsn: input.hsn || null, taxBps: Math.round(input.taxPercent * 100),
    lowStockAt: input.lowStockAt, lengthMm: Math.round(input.lengthCm * 10), breadthMm: Math.round(input.breadthCm * 10), heightMm: Math.round(input.heightCm * 10),
    options: input.options, updatedAt: new Date(),
    ...(input.costs ? {
      costExtras: { packagingPaise: toPaise(input.costs.packagingRupees), labourPaise: toPaise(input.costs.labourRupees), otherPaise: toPaise(input.costs.otherRupees), overheadPaise: toPaise(input.costs.overheadRupees) },
      ...(input.costs.productRupees !== null && !hasVariants ? { unitCostPaise: toPaise(input.costs.productRupees) } : {}),
    } : {}),
  };
  const pid = id ?? newId("sp");
  await db.transaction(async (tx) => {
    // stock typed in the editor is "available": remember what it was so the change is in the stock history
    const [before] = id ? await tx.select({ stock: schema.storeProducts.stock }).from(schema.storeProducts).where(and(eq(schema.storeProducts.id, id), eq(schema.storeProducts.storeId, s.id))) : [];
    const beforeV = id ? await tx.select({ id: schema.storeProductVariants.id, stock: schema.storeProductVariants.stock }).from(schema.storeProductVariants).where(eq(schema.storeProductVariants.productId, id)) : [];
    if (id) {
      const res = await tx.update(schema.storeProducts).set(values).where(and(eq(schema.storeProducts.id, id), eq(schema.storeProducts.storeId, s.id))).returning({ id: schema.storeProducts.id });
      if (!res.length) throw new StoreError("Product not found");
    } else {
      await tx.insert(schema.storeProducts).values({ id: pid, storeId: s.id, orgId, ...values });
    }
    // variants: update the ones we know, add new ones, archive removed ones (orders keep pointing at them)
    const existing = await tx.select({ id: schema.storeProductVariants.id }).from(schema.storeProductVariants).where(eq(schema.storeProductVariants.productId, pid));
    const known = new Set(existing.map((e) => e.id));
    const kept = new Set<string>();
    for (const [i, v] of input.variants.entries()) {
      const row = { title: v.values.join(" / "), optionValues: v.values, sku: v.sku || null, pricePaise: toPaise(v.priceRupees), comparePaise: v.compareRupees ? toPaise(v.compareRupees) : null, stock: v.stock, weightGrams: v.weightGrams, sort: i, archived: false };
      if (v.id && known.has(v.id)) {
        await tx.update(schema.storeProductVariants).set(row).where(eq(schema.storeProductVariants.id, v.id)); kept.add(v.id);
        const was = beforeV.find((b) => b.id === v.id)?.stock ?? 0;
        if (v.stock !== was) await move(tx, { storeId: s.id, orgId }, { productId: pid, variantId: v.id }, "edit", { available: v.stock - was }, { reason: "Changed in the product editor" });
      } else {
        const vid = newId("spv");
        await tx.insert(schema.storeProductVariants).values({ id: vid, productId: pid, storeId: s.id, orgId, ...row });
        if (v.stock) await move(tx, { storeId: s.id, orgId }, { productId: pid, variantId: vid }, "opening", { available: v.stock }, { reason: "New option" });
      }
    }
    if (!hasVariants && input.stock !== (before?.stock ?? 0)) await move(tx, { storeId: s.id, orgId }, { productId: pid, variantId: null }, before ? "edit" : "opening", { available: input.stock - (before?.stock ?? 0) }, { reason: before ? "Changed in the product editor" : "New product" });
    const gone = [...known].filter((x) => !kept.has(x));
    if (gone.length) await tx.update(schema.storeProductVariants).set({ archived: true }).where(inArray(schema.storeProductVariants.id, gone));
  });
  if (input.status === "active") await markStep(orgId, 3);
  return { id: pid, slug };
}

export async function productVariants(orgId: string, productId: string) {
  const db = await getDb();
  return db.select().from(schema.storeProductVariants)
    .where(and(eq(schema.storeProductVariants.productId, productId), eq(schema.storeProductVariants.orgId, orgId), eq(schema.storeProductVariants.archived, false)))
    .orderBy(asc(schema.storeProductVariants.sort));
}

export async function archiveProduct(orgId: string, id: string) {
  const s = await requireStore(orgId);
  const db = await getDb();
  await db.update(schema.storeProducts).set({ status: "archived", updatedAt: new Date() }).where(and(eq(schema.storeProducts.id, id), eq(schema.storeProducts.storeId, s.id)));
}

// ---------- categories ----------
export async function addCategory(orgId: string, name: string) {
  const s = await requireStore(orgId);
  const clean = name.trim().slice(0, 60);
  if (clean.length < 2) throw new StoreError("Enter a category name");
  const slug = slugify(clean);
  if (!slug) throw new StoreError("Use letters or numbers in the name");
  const db = await getDb();
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.storeCategories).where(eq(schema.storeCategories.storeId, s.id));
  if (n >= 50) throw new StoreError("You can have up to 50 categories");
  try {
    const id = newId("sc");
    await db.insert(schema.storeCategories).values({ id, storeId: s.id, orgId, name: clean, slug, sort: n });
    return id;
  } catch { throw new StoreError("A category with this name already exists"); }
}

export async function deleteCategory(orgId: string, id: string) {
  const s = await requireStore(orgId);
  const db = await getDb();
  await db.update(schema.storeProducts).set({ categoryId: null }).where(and(eq(schema.storeProducts.storeId, s.id), eq(schema.storeProducts.categoryId, id)));
  await db.delete(schema.storeCategories).where(and(eq(schema.storeCategories.id, id), eq(schema.storeCategories.storeId, s.id)));
}

export async function listCategories(orgId: string) {
  const s = await requireStore(orgId);
  const db = await getDb();
  return db.select().from(schema.storeCategories).where(eq(schema.storeCategories.storeId, s.id)).orderBy(asc(schema.storeCategories.sort));
}

// ---------- media ----------
export const MEDIA_MAX_BYTES = 1_500_000;

export async function uploadMedia(orgId: string, buf: Buffer) {
  const s = await requireStore(orgId);
  if (buf.length > MEDIA_MAX_BYTES) throw new StoreError("Image must be under 1.5 MB");
  const isWebp = buf.length > 12 && buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP";
  const kind = isWebp ? { mime: "image/webp" } : sniffUpload(buf);
  if (!kind || !["image/png", "image/jpeg", "image/webp"].includes(kind.mime)) throw new StoreError("Use a PNG, JPG or WebP image");
  const db = await getDb();
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.storeMedia).where(eq(schema.storeMedia.storeId, s.id));
  if (n >= 2000) throw new StoreError("Image limit reached (2,000). Remove unused products first.");
  const id = newId("sm", 20);
  await db.insert(schema.storeMedia).values({ id, storeId: s.id, orgId, mime: kind.mime, sizeBytes: buf.length, data: buf });
  return id;
}
