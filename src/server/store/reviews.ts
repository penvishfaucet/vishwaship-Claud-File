import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/server/db/client";
import { newId } from "@/server/util/ids";
import { StoreError } from "./catalog";
import { storeForOrg } from "./service";

/**
 * Product reviews: published at once (the merchant can hide or delete them later). A review is marked
 * "Verified buyer" when the mobile entered matches a placed order in this store that contains the product;
 * the mobile is only used for that check and is never stored or shown.
 */
export const ReviewInput = z.object({
  rating: z.number().int().min(1, "Pick a rating").max(5),
  title: z.string().trim().max(80).default(""),
  body: z.string().trim().min(5, "Write a few words about the product").max(1500),
  name: z.string().trim().min(2, "Enter your name").max(40),
  mobile: z.string().trim().max(15).default(""),
  /** Honeypot: real buyers never fill this. */
  website: z.string().max(200).default(""),
});

const clean = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").replace(/https?:\/\/\S+/gi, "[link removed]");

export async function addReview(store: { id: string; orgId: string }, productId: string, input: z.infer<typeof ReviewInput>) {
  if (input.website) return { id: null, verified: false }; // silently drop bots
  const db = await getDb();
  const [p] = await db.select({ id: schema.storeProducts.id }).from(schema.storeProducts)
    .where(and(eq(schema.storeProducts.id, productId), eq(schema.storeProducts.storeId, store.id), eq(schema.storeProducts.status, "active")));
  if (!p) throw new StoreError("Product not found");
  const mob = input.mobile.replace(/\D/g, "").slice(-10);
  let verified = false;
  if (mob.length === 10) {
    const [o] = await db.select({ id: schema.storeOrders.id }).from(schema.storeOrders).where(and(
      eq(schema.storeOrders.storeId, store.id), eq(schema.storeOrders.status, "placed"),
      sql`right(regexp_replace(${schema.storeOrders.buyer}->>'mobile', '[^0-9]', '', 'g'), 10) = ${mob}`,
      sql`${schema.storeOrders.lines} @> ${JSON.stringify([{ productId }])}::jsonb`,
    )).limit(1);
    verified = !!o;
  }
  const id = newId("srv");
  await db.insert(schema.storeReviews).values({
    id, storeId: store.id, orgId: store.orgId, productId, rating: input.rating, title: clean(input.title) || null, body: clean(input.body), name: clean(input.name), verified,
  });
  return { id, verified };
}

export async function productReviews(storeId: string, productId: string, limit = 30) {
  const db = await getDb();
  return db.select({ id: schema.storeReviews.id, rating: schema.storeReviews.rating, title: schema.storeReviews.title, body: schema.storeReviews.body, name: schema.storeReviews.name, verified: schema.storeReviews.verified, createdAt: schema.storeReviews.createdAt })
    .from(schema.storeReviews).where(and(eq(schema.storeReviews.storeId, storeId), eq(schema.storeReviews.productId, productId), eq(schema.storeReviews.status, "published")))
    .orderBy(desc(schema.storeReviews.createdAt)).limit(limit);
}

export async function storeReviewsForOrg(orgId: string, status?: string) {
  const s = await storeForOrg(orgId);
  if (!s) throw new StoreError("Create your store first");
  const db = await getDb();
  return db.select({ r: schema.storeReviews, product: schema.storeProducts.title, slug: schema.storeProducts.slug })
    .from(schema.storeReviews).innerJoin(schema.storeProducts, eq(schema.storeProducts.id, schema.storeReviews.productId))
    .where(and(eq(schema.storeReviews.storeId, s.id), status === "hidden" || status === "published" ? eq(schema.storeReviews.status, status) : undefined))
    .orderBy(desc(schema.storeReviews.createdAt)).limit(300);
}

export async function moderateReview(orgId: string, id: string, action: "hide" | "show" | "delete") {
  const s = await storeForOrg(orgId);
  if (!s) throw new StoreError("Create your store first");
  const db = await getDb();
  const where = and(eq(schema.storeReviews.id, id), eq(schema.storeReviews.storeId, s.id));
  const r = action === "delete"
    ? await db.delete(schema.storeReviews).where(where).returning({ id: schema.storeReviews.id })
    : await db.update(schema.storeReviews).set({ status: action === "hide" ? "hidden" : "published" }).where(where).returning({ id: schema.storeReviews.id });
  if (!r.length) throw new StoreError("Review not found");
}
