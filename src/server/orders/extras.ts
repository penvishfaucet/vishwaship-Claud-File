import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { newId } from "@/server/util/ids";

/** Attach the account's own tags to an order (unknown / foreign tag ids are ignored). */
export async function setOrderTags(orgId: string, orderId: string, tagIds: string[]) {
  const db = await getDb();
  const own = tagIds.length ? await db.select({ id: schema.orderTags.id }).from(schema.orderTags).where(and(eq(schema.orderTags.orgId, orgId), inArray(schema.orderTags.id, tagIds.slice(0, 20)))) : [];
  await db.delete(schema.orderTagLinks).where(eq(schema.orderTagLinks.orderId, orderId));
  if (own.length) await db.insert(schema.orderTagLinks).values(own.map((t) => ({ orderId, tagId: t.id }))).onConflictDoNothing();
  return own.length;
}

/** Save / update the consignee as a buyer record (keyed by mobile), adding the address if new. */
export async function saveBuyerFromConsignee(orgId: string, c: { name: string; mobile: string; email?: string; line1: string; line2?: string; pincode: string; city: string; state: string }) {
  const db = await getDb();
  const mobile = c.mobile.replace(/\D/g, "").slice(-10);
  const [b] = await db.select().from(schema.buyers).where(and(eq(schema.buyers.orgId, orgId), eq(schema.buyers.mobile, mobile)));
  const addr = { label: "Default", line1: c.line1, line2: c.line2 ?? "", pincode: c.pincode, city: c.city, state: c.state };
  if (!b) { await db.insert(schema.buyers).values({ id: newId("by"), orgId, name: c.name, mobile, email: c.email || null, addresses: [addr] }).onConflictDoNothing(); return; }
  const list = b.addresses as Array<typeof addr>;
  if (!list.some((a) => a.line1 === addr.line1 && a.pincode === addr.pincode)) list.push({ ...addr, label: `Address ${list.length + 1}` });
  await db.update(schema.buyers).set({ name: c.name, email: c.email || b.email, addresses: list.slice(0, 10), updatedAt: new Date() }).where(eq(schema.buyers.id, b.id));
}

export async function tagsForOrders(orderIds: string[]) {
  if (!orderIds.length) return new Map<string, Array<{ id: string; name: string; color: string }>>();
  const db = await getDb();
  const rows = await db.select({ orderId: schema.orderTagLinks.orderId, id: schema.orderTags.id, name: schema.orderTags.name, color: schema.orderTags.color })
    .from(schema.orderTagLinks).innerJoin(schema.orderTags, eq(schema.orderTags.id, schema.orderTagLinks.tagId)).where(inArray(schema.orderTagLinks.orderId, orderIds));
  const m = new Map<string, Array<{ id: string; name: string; color: string }>>();
  for (const r of rows) m.set(r.orderId, [...(m.get(r.orderId) ?? []), { id: r.id, name: r.name, color: r.color }]);
  return m;
}
