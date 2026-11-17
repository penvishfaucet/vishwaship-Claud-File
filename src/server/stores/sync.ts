import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { audit } from "@/server/audit";
import { OrderInput, createOrder } from "@/server/orders/create";
import { decryptJson } from "@/server/security/crypto";
import { newId } from "@/server/util/ids";
import { type StoreCreds, shopify, woo } from "./clients";
import { type DefaultPackage, type MapResult, mapShopifyOrder, mapWooOrder } from "./mapping";

/**
 * Pull open orders from one store connection. Dedupe is enforced by the unique index on
 * orders(org_id, external_store_id, external_order_id) plus an explicit pre-check, so re-running a
 * sync (manual, scheduled or replayed) never creates duplicates.
 */
export async function syncStore(connectionId: string, actor: { userId?: string; kind: "customer" | "system" }) {
  const db = await getDb();
  const [c] = await db.select().from(schema.storeConnections).where(eq(schema.storeConnections.id, connectionId));
  if (!c || c.status === "disconnected") return { ok: false as const, message: "Store not connected" };
  if (!c.warehouseId) return { ok: false as const, message: "Map a pickup address to this store first" };
  const creds = decryptJson<StoreCreds>(c.credentialsEnc);
  const def = c.defaultPackage as DefaultPackage;
  const runId = newId("sync");
  let mapped: MapResult[];
  try {
    mapped = c.platform === "shopify"
      ? (await shopify.openOrders(c.storeUrl, creds)).map((o) => mapShopifyOrder(o, c.warehouseId!, def))
      : (await woo.openOrders(c.storeUrl, creds)).map((o) => mapWooOrder(o, c.warehouseId!, def));
  } catch (e) {
    await db.update(schema.storeConnections).set({ status: "error", lastError: (e as Error).message.slice(0, 300) }).where(eq(schema.storeConnections.id, c.id));
    return { ok: false as const, message: (e as Error).message };
  }
  const counts = { imported: 0, duplicate: 0, error: 0, skipped: 0 };
  for (const m of mapped) {
    const log = (outcome: keyof typeof counts, message?: string, orderId?: string) => {
      counts[outcome]++;
      return db.insert(schema.storeImportLog).values({ id: newId("sil"), connectionId: c.id, runId, externalOrderId: m.externalId, externalOrderName: m.name, outcome, message: message ?? null, orderId: orderId ?? null });
    };
    if (!m.ok) { await log(m.skip ? "skipped" : "error", m.reason); continue; }
    const [dup] = await db.select({ id: schema.orders.id }).from(schema.orders)
      .where(and(eq(schema.orders.orgId, c.orgId), eq(schema.orders.externalStoreId, c.id), eq(schema.orders.externalOrderId, m.externalId)));
    if (dup) { counts.duplicate++; continue; } // already imported earlier; not logged again to keep history readable
    const p = OrderInput.safeParse(m.input);
    if (!p.success) { await log("error", p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")); continue; }
    try {
      const r = await createOrder(c.orgId, p.data, c.platform as "shopify" | "woocommerce", { storeId: c.id, orderId: m.externalId });
      if (r.ok) await log("imported", r.codHold ? "Waiting for COD confirmation" : undefined, r.orderId);
      else await log("error", r.message);
    } catch (e) {
      // unique-index race with a parallel sync → treat as duplicate
      if (/unique|duplicate/i.test((e as Error).message)) counts.duplicate++; else await log("error", (e as Error).message.slice(0, 300));
    }
  }
  await db.update(schema.storeConnections).set({ status: "connected", lastError: null, lastSyncAt: new Date() }).where(eq(schema.storeConnections.id, c.id));
  await audit({ actorUserId: actor.userId, actorKind: actor.kind, orgId: c.orgId, action: "store.sync", targetType: "store_connection", targetId: c.id, details: counts });
  return { ok: true as const, ...counts };
}

/** After booking: push AWB + tracking link back to the store (if enabled for that connection). */
export async function pushTrackingForOrder(orderId: string) {
  const db = await getDb();
  const [row] = await db.select({ o: schema.orders, s: schema.shipments, c: schema.storeConnections }).from(schema.orders)
    .innerJoin(schema.shipments, eq(schema.shipments.orderId, schema.orders.id))
    .innerJoin(schema.storeConnections, eq(schema.storeConnections.id, schema.orders.externalStoreId))
    .where(eq(schema.orders.id, orderId));
  if (!row || !row.c.pushTracking || !row.s.awb || !row.o.externalOrderId) return "nothing to push";
  const creds = decryptJson<StoreCreds>(row.c.credentialsEnc);
  const t = { number: row.s.awb, company: row.s.carrierName, url: `${process.env.APP_URL ?? "https://vishwaship.com"}/track/?awb=${encodeURIComponent(row.s.awb)}` };
  return row.c.platform === "shopify" ? shopify.pushTracking(row.c.storeUrl, creds, row.o.externalOrderId, t) : woo.pushTracking(row.c.storeUrl, creds, row.o.externalOrderId, t);
}
