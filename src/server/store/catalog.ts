import "server-only";
import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/server/db/client";
import { newId, randomToken } from "@/server/util/ids";
import { sniffUpload } from "@/server/storage";
import { slugify } from "@/lib/store-themes";
import { markStep, storeForOrg } from "./service";

/** Phase 1 catalog: simple products (no variants yet), categories and store images. All scoped by the session org. */

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
  const values = {
    title: input.title, slug, description: input.description || null, pricePaise: toPaise(input.priceRupees),
    comparePaise: input.compareRupees ? toPaise(input.compareRupees) : null, categoryId: input.categoryId, images: input.images,
    stock: input.stock, weightGrams: input.weightGrams, status: input.status, featured: input.featured,
    seo: { title: input.seoTitle, description: input.seoDescription }, updatedAt: new Date(),
  };
  if (id) {
    const res = await db.update(schema.storeProducts).set(values).where(and(eq(schema.storeProducts.id, id), eq(schema.storeProducts.storeId, s.id))).returning({ id: schema.storeProducts.id });
    if (!res.length) throw new StoreError("Product not found");
  } else {
    id = newId("sp");
    await db.insert(schema.storeProducts).values({ id, storeId: s.id, orgId, ...values });
  }
  if (input.status === "active") await markStep(orgId, 3);
  return { id, slug };
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
  if (n >= 500) throw new StoreError("Image limit reached (500). Remove unused products first.");
  const id = newId("sm", 20);
  await db.insert(schema.storeMedia).values({ id, storeId: s.id, orgId, mime: kind.mime, sizeBytes: buf.length, data: buf });
  return id;
}
