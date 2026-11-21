import "server-only";
import { and, desc, eq, gt, inArray, lte } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/server/db/client";
import { newId } from "@/server/util/ids";
import type { SaleRule } from "@/lib/store-sale";
import { StoreError } from "./catalog";
import { storeForOrg } from "./service";

type Db = Awaited<ReturnType<typeof getDb>>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** Sales running right now (started, not ended, switched on). */
export async function activeSales(storeId: string, q?: Db | Tx, now = new Date()): Promise<SaleRule[]> {
  const db = q ?? (await getDb());
  const rows = await db.select().from(schema.storeSaleEvents).where(and(eq(schema.storeSaleEvents.storeId, storeId), eq(schema.storeSaleEvents.active, true), lte(schema.storeSaleEvents.startsAt, now), gt(schema.storeSaleEvents.endsAt, now)));
  return rows.map((r) => ({ id: r.id, name: r.name, percentOff: r.percentOff, scope: r.scope, categoryIds: r.categoryIds as string[], productIds: r.productIds as string[], endsAt: r.endsAt, bannerText: r.bannerText }));
}

export const SaleInput = z.object({
  name: z.string().trim().min(2).max(60),
  percentOff: z.coerce.number().int().min(1, "At least 1% off").max(90, "At most 90% off"),
  scope: z.enum(["all", "categories", "products"]),
  categoryIds: z.array(z.string().max(60)).max(50).default([]),
  productIds: z.array(z.string().max(60)).max(500).default([]),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  bannerText: z.string().trim().max(120).default(""),
  active: z.boolean().default(true),
});

export async function saveSale(orgId: string, input: z.infer<typeof SaleInput>, id?: string) {
  const s = await storeForOrg(orgId);
  if (!s) throw new StoreError("Create your store first");
  const starts = new Date(input.startsAt), ends = new Date(input.endsAt);
  if (ends <= starts) throw new StoreError("The sale must end after it starts");
  if (ends.getTime() - starts.getTime() > 90 * 86400_000) throw new StoreError("A sale can run for at most 90 days");
  const db = await getDb();
  const cats = input.scope === "categories" ? [...new Set(input.categoryIds)] : [];
  const prods = input.scope === "products" ? [...new Set(input.productIds)] : [];
  if (input.scope === "categories") {
    if (!cats.length) throw new StoreError("Pick at least one category");
    const ok = await db.select({ id: schema.storeCategories.id }).from(schema.storeCategories).where(and(eq(schema.storeCategories.storeId, s.id), inArray(schema.storeCategories.id, cats)));
    if (ok.length !== cats.length) throw new StoreError("Category not found in your store");
  }
  if (input.scope === "products") {
    if (!prods.length) throw new StoreError("Pick at least one product");
    const ok = await db.select({ id: schema.storeProducts.id }).from(schema.storeProducts).where(and(eq(schema.storeProducts.storeId, s.id), inArray(schema.storeProducts.id, prods)));
    if (ok.length !== prods.length) throw new StoreError("Product not found in your store");
  }
  const v = { name: input.name, percentOff: input.percentOff, scope: input.scope, categoryIds: cats, productIds: prods, startsAt: starts, endsAt: ends, bannerText: input.bannerText || null, active: input.active, updatedAt: new Date() };
  if (id) {
    const r = await db.update(schema.storeSaleEvents).set(v).where(and(eq(schema.storeSaleEvents.id, id), eq(schema.storeSaleEvents.storeId, s.id))).returning({ id: schema.storeSaleEvents.id });
    if (!r.length) throw new StoreError("Sale not found");
    return id;
  }
  const nid = newId("sse");
  await db.insert(schema.storeSaleEvents).values({ id: nid, storeId: s.id, orgId, ...v });
  return nid;
}

export async function deleteSale(orgId: string, id: string) {
  const s = await storeForOrg(orgId);
  if (!s) throw new StoreError("Create your store first");
  const db = await getDb();
  const r = await db.delete(schema.storeSaleEvents).where(and(eq(schema.storeSaleEvents.id, id), eq(schema.storeSaleEvents.storeId, s.id))).returning({ id: schema.storeSaleEvents.id });
  if (!r.length) throw new StoreError("Sale not found");
}

export async function listSales(storeId: string) {
  const db = await getDb();
  return db.select().from(schema.storeSaleEvents).where(eq(schema.storeSaleEvents.storeId, storeId)).orderBy(desc(schema.storeSaleEvents.startsAt)).limit(100);
}
