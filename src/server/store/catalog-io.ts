import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { toCsv } from "@/lib/csv";
import { getDb, schema } from "@/server/db/client";
import { parseCsv } from "@/server/orders/bulk";
import { newId } from "@/server/util/ids";
import { slugify } from "@/lib/store-themes";
import { ProductInput, StoreError, addCategory, saveProduct } from "./catalog";
import { storeForOrg } from "./service";

/**
 * Products CSV (one row per product, or one row per variant sharing the same `handle`) and coupons.
 * Import is two-step: preview (every row checked, errors shown per row) then import (valid products only).
 */

export const CSV_HEADERS = ["handle", "title", "description", "category", "status", "price", "compare_price", "stock", "weight_grams", "sku", "hsn", "gst_percent", "low_stock_at", "length_cm", "breadth_cm", "height_cm", "option1_name", "option1_value", "option2_name", "option2_value", "option3_name", "option3_value"] as const;
export const MAX_IMPORT_ROWS = 1000;

export async function exportProductsCsv(orgId: string) {
  const s = await storeForOrg(orgId);
  if (!s) throw new StoreError("Create your store first");
  const db = await getDb();
  const prods = await db.select().from(schema.storeProducts).where(eq(schema.storeProducts.storeId, s.id)).orderBy(asc(schema.storeProducts.createdAt));
  const cats = new Map((await db.select().from(schema.storeCategories).where(eq(schema.storeCategories.storeId, s.id))).map((c) => [c.id, c.name]));
  const vars = await db.select().from(schema.storeProductVariants).where(and(eq(schema.storeProductVariants.storeId, s.id), eq(schema.storeProductVariants.archived, false))).orderBy(asc(schema.storeProductVariants.sort));
  const rows: unknown[][] = [];
  for (const p of prods) {
    const base = [p.slug, p.title, p.description ?? "", p.categoryId ? cats.get(p.categoryId) ?? "" : "", p.status];
    const tail = (sku: string | null) => [sku ?? "", p.hsn ?? "", p.taxBps / 100, p.lowStockAt, p.lengthMm / 10, p.breadthMm / 10, p.heightMm / 10];
    const opts = p.options as string[];
    const pv = vars.filter((v) => v.productId === p.id);
    if (!opts.length || !pv.length) rows.push([...base, p.pricePaise / 100, p.comparePaise ? p.comparePaise / 100 : "", p.stock, p.weightGrams, ...tail(p.sku), "", "", "", "", "", ""]);
    else for (const v of pv) {
      const vals = v.optionValues as string[];
      rows.push([...base, v.pricePaise / 100, v.comparePaise ? v.comparePaise / 100 : "", v.stock, v.weightGrams ?? p.weightGrams, ...tail(v.sku ?? p.sku),
        opts[0] ?? "", vals[0] ?? "", opts[1] ?? "", vals[1] ?? "", opts[2] ?? "", vals[2] ?? ""]);
    }
  }
  return toCsv([...CSV_HEADERS], rows);
}

export type ImportRow = { row: number; handle: string; title: string; variant: string; errors: string[] };
export type ImportPreview = { rows: ImportRow[]; products: number; valid: number; headerError?: string };

const num = (v: string) => (v.trim() === "" ? NaN : Number(v.replace(/,/g, "")));
const optNum = (v: string, d: number) => (v.trim() === "" ? d : Number(v.replace(/,/g, "")));

/** Parse + validate. Returns per-row errors and the grouped product inputs (only fully valid products). */
export async function planImport(orgId: string, text: string) {
  const s = await storeForOrg(orgId);
  if (!s) throw new StoreError("Create your store first");
  const all = parseCsv(text);
  if (!all.length) return { preview: { rows: [], products: 0, valid: 0, headerError: "The file is empty" } as ImportPreview, plan: [] };
  const header = all[0].map((h) => h.trim().toLowerCase());
  const missing = ["title", "price"].filter((h) => !header.includes(h));
  if (missing.length) return { preview: { rows: [], products: 0, valid: 0, headerError: `Missing column(s): ${missing.join(", ")}. Download the sample to see the format.` } as ImportPreview, plan: [] };
  const data = all.slice(1);
  if (data.length > MAX_IMPORT_ROWS) return { preview: { rows: [], products: 0, valid: 0, headerError: `Up to ${MAX_IMPORT_ROWS} rows per file` } as ImportPreview, plan: [] };
  const col = (r: string[], k: (typeof CSV_HEADERS)[number]) => (header.indexOf(k) >= 0 ? (r[header.indexOf(k)] ?? "").trim() : "");

  const db = await getDb();
  const existing = await db.select({ id: schema.storeProducts.id, slug: schema.storeProducts.slug, images: schema.storeProducts.images }).from(schema.storeProducts).where(eq(schema.storeProducts.storeId, s.id));

  type Group = { handle: string; rows: Array<{ n: number; r: string[] }> };
  const groups = new Map<string, Group>();
  data.forEach((r, i) => {
    const handle = slugify(col(r, "handle") || col(r, "title")) || `row-${i + 2}`;
    const g = groups.get(handle) ?? { handle, rows: [] };
    g.rows.push({ n: i + 2, r });
    groups.set(handle, g);
  });

  const rows: ImportRow[] = [];
  const plan: Array<{ id?: string; input: ProductInput; category: string }> = [];
  for (const g of groups.values()) {
    const first = g.rows[0].r;
    const options = [col(first, "option1_name"), col(first, "option2_name"), col(first, "option3_name")].filter(Boolean);
    const groupErrors: string[] = [];
    const variants = options.length ? g.rows.map(({ r }) => ({
      id: null, values: options.map((_, k) => col(r, (["option1_value", "option2_value", "option3_value"] as const)[k])),
      sku: col(r, "sku"), priceRupees: num(col(r, "price")), compareRupees: col(r, "compare_price") ? num(col(r, "compare_price")) : null,
      stock: optNum(col(r, "stock"), 0), weightGrams: col(r, "weight_grams") ? num(col(r, "weight_grams")) : null,
    })) : [];
    if (!options.length && g.rows.length > 1) groupErrors.push(`Handle "${g.handle}" is used on ${g.rows.length} rows; add option columns for variants or use different handles`);
    const raw = {
      title: col(first, "title"), slug: g.handle, description: col(first, "description"), priceRupees: num(col(first, "price")),
      compareRupees: col(first, "compare_price") && !options.length ? num(col(first, "compare_price")) : null, categoryId: null, images: [] as string[],
      stock: optNum(col(first, "stock"), 0), weightGrams: optNum(col(first, "weight_grams"), 500), status: (col(first, "status") || "active").toLowerCase(),
      featured: false, seoTitle: "", seoDescription: "", sku: options.length ? "" : col(first, "sku"), hsn: col(first, "hsn"), taxPercent: optNum(col(first, "gst_percent"), 0),
      lowStockAt: optNum(col(first, "low_stock_at"), 5), lengthCm: optNum(col(first, "length_cm"), 0), breadthCm: optNum(col(first, "breadth_cm"), 0), heightCm: optNum(col(first, "height_cm"), 0),
      options, variants,
    };
    const p = ProductInput.safeParse(raw);
    const issues = p.success ? [] : p.error.issues;
    for (const [k, { n, r }] of g.rows.entries()) {
      const errs = [...(k === 0 ? groupErrors : [])];
      for (const iss of issues) {
        const isRowIssue = iss.path[0] === "variants" && typeof iss.path[1] === "number";
        if (isRowIssue ? iss.path[1] === k : k === 0) errs.push(`${iss.path.filter((x) => typeof x === "string").join(".") || "row"}: ${iss.message}`.replace(/^variants\.?/, ""));
      }
      rows.push({ row: n, handle: g.handle, title: col(r, "title") || raw.title, variant: options.length ? options.map((_, i) => col(r, (["option1_value", "option2_value", "option3_value"] as const)[i])).join(" / ") : "", errors: errs });
    }
    if (p.success && !groupErrors.length) {
      const hit = existing.find((e) => e.slug === g.handle);
      plan.push({ id: hit?.id, input: { ...p.data, images: (hit?.images as string[]) ?? [] }, category: col(first, "category") });
    }
  }
  return { preview: { rows, products: groups.size, valid: plan.length } as ImportPreview, plan };
}

/** Import valid products (create, or update the product with the same handle). Categories are created by name. */
export async function runImport(orgId: string, text: string) {
  const { preview, plan } = await planImport(orgId, text);
  if (preview.headerError) throw new StoreError(preview.headerError);
  const s = (await storeForOrg(orgId))!;
  const db = await getDb();
  let created = 0, updated = 0;
  for (const item of plan) {
    let categoryId: string | null = null;
    if (item.category) {
      const [c] = await db.select().from(schema.storeCategories).where(and(eq(schema.storeCategories.storeId, s.id), eq(schema.storeCategories.slug, slugify(item.category))));
      categoryId = c?.id ?? (await addCategory(orgId, item.category));
    }
    if (item.id) {
      // keep the ids of variants that already exist with the same option values
      const old = await db.select().from(schema.storeProductVariants).where(and(eq(schema.storeProductVariants.productId, item.id), eq(schema.storeProductVariants.archived, false)));
      item.input.variants = item.input.variants.map((v) => ({ ...v, id: old.find((o) => (o.optionValues as string[]).join("|").toLowerCase() === v.values.join("|").toLowerCase())?.id ?? null }));
    }
    await saveProduct(orgId, { ...item.input, categoryId }, item.id);
    if (item.id) updated++; else created++;
  }
  return { created, updated, skipped: preview.products - plan.length };
}

export const SAMPLE_CSV = toCsv([...CSV_HEADERS], [
  ["cotton-kurta", "Cotton Kurta", "Hand block printed", "Kurtas", "active", 1299, 1799, 5, 400, "KUR-S", "6204", 5, 3, 30, 25, 3, "Size", "S", "", "", "", ""],
  ["cotton-kurta", "Cotton Kurta", "", "Kurtas", "active", 1299, 1799, 8, 420, "KUR-M", "6204", 5, 3, 30, 25, 3, "Size", "M", "", "", "", ""],
  ["brass-diya", "Brass Diya", "Polished brass", "Home decor", "active", 499, "", 20, 250, "DIYA-1", "7418", 12, 5, 10, 10, 6, "", "", "", "", "", ""],
]);

// ---------- coupons ----------
export const CouponInput = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,30}$/, "Use 3-30 letters, numbers, - or _"),
  kind: z.enum(["percent", "flat", "free_shipping"]),
  value: z.number().min(0).max(1_00_000),
  maxDiscountRupees: z.number().min(0).max(1_00_000).nullable().default(null),
  minSubtotalRupees: z.number().min(0).max(10_00_000).default(0),
  maxUses: z.number().int().min(1).max(1_000_000).nullable().default(null),
  startsAt: z.string().max(30).nullable().default(null),
  endsAt: z.string().max(30).nullable().default(null),
  active: z.boolean().default(true),
  showOnStore: z.boolean().default(false),
}).superRefine((v, ctx) => {
  if (v.kind === "percent" && (v.value <= 0 || v.value > 90)) ctx.addIssue({ code: "custom", path: ["value"], message: "Percent must be between 1 and 90" });
  if (v.kind === "flat" && v.value <= 0) ctx.addIssue({ code: "custom", path: ["value"], message: "Enter the discount amount" });
});

export async function listCoupons(orgId: string) {
  const s = await storeForOrg(orgId);
  if (!s) return [];
  const db = await getDb();
  return db.select().from(schema.storeCoupons).where(eq(schema.storeCoupons.storeId, s.id)).orderBy(asc(schema.storeCoupons.code));
}

const day = (v: string | null, end: boolean) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T${end ? "23:59:59" : "00:00:00"}+05:30`) : null);

export async function saveCoupon(orgId: string, input: z.infer<typeof CouponInput>, id?: string) {
  const s = await storeForOrg(orgId);
  if (!s) throw new StoreError("Create your store first");
  const values = {
    code: input.code, kind: input.kind, value: input.kind === "percent" ? Math.round(input.value * 100) : input.kind === "flat" ? Math.round(input.value * 100) : 0,
    maxDiscountPaise: input.maxDiscountRupees ? Math.round(input.maxDiscountRupees * 100) : null, minSubtotalPaise: Math.round(input.minSubtotalRupees * 100),
    maxUses: input.maxUses, startsAt: day(input.startsAt, false), endsAt: day(input.endsAt, true), active: input.active, showOnStore: input.showOnStore,
  };
  const db = await getDb();
  try {
    if (id) {
      const r = await db.update(schema.storeCoupons).set(values).where(and(eq(schema.storeCoupons.id, id), eq(schema.storeCoupons.storeId, s.id))).returning({ id: schema.storeCoupons.id });
      if (!r.length) throw new StoreError("Coupon not found");
      return id;
    }
    const nid = newId("cpn");
    await db.insert(schema.storeCoupons).values({ id: nid, storeId: s.id, orgId, ...values });
    return nid;
  } catch (e) {
    if (e instanceof StoreError) throw e;
    throw new StoreError("A coupon with this code already exists");
  }
}
