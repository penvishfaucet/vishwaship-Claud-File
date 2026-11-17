import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { apiCustomer } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db/client";
import { apiError, parseJson } from "@/server/http";
import { encryptJson, maskSecret } from "@/server/security/crypto";
import { normalizeStoreUrl, shopify, woo } from "@/server/stores/clients";
import { newId } from "@/server/util/ids";

const Connect = z.discriminatedUnion("platform", [
  z.object({ platform: z.literal("shopify"), storeUrl: z.string().min(4).max(200), token: z.string().min(10).max(200), warehouseId: z.string() }),
  z.object({ platform: z.literal("woocommerce"), storeUrl: z.string().min(4).max(200), key: z.string().regex(/^ck_[a-f0-9]{20,}$/i, "Consumer key starts with ck_"), secret: z.string().regex(/^cs_[a-f0-9]{20,}$/i, "Consumer secret starts with cs_"), warehouseId: z.string() }),
]);

/** Connect: validates the URL, tests the credentials against the store, then stores them encrypted. */
export async function POST(req: Request) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const p = await parseJson(req, Connect);
  if (!p.ok) return p.res;
  const db = await getDb();
  const [wh] = await db.select().from(schema.warehouses).where(and(eq(schema.warehouses.id, p.data.warehouseId), eq(schema.warehouses.orgId, s.orgId)));
  if (!wh) return apiError(422, "validation_error", "Choose a pickup address");
  let base: string;
  try { base = normalizeStoreUrl(p.data.platform, p.data.storeUrl); } catch (e) { return apiError(422, "validation_error", (e as Error).message); }
  const creds = p.data.platform === "shopify" ? { token: p.data.token } : { key: p.data.key, secret: p.data.secret };
  let message: string;
  try { message = p.data.platform === "shopify" ? await shopify.test(base, creds) : await woo.test(base, creds); }
  catch (e) { return apiError(422, "provider_error", `Connection test failed: ${(e as Error).message}`); }
  const hint = p.data.platform === "shopify" ? maskSecret(p.data.token) : maskSecret(p.data.key);
  const [existing] = await db.select().from(schema.storeConnections).where(and(eq(schema.storeConnections.orgId, s.orgId), eq(schema.storeConnections.storeUrl, base)));
  const id = existing?.id ?? newId("store");
  if (existing) await db.update(schema.storeConnections).set({ credentialsEnc: encryptJson(creds), credentialsHint: hint, status: "connected", warehouseId: wh.id, lastError: null }).where(eq(schema.storeConnections.id, id));
  else await db.insert(schema.storeConnections).values({ id, orgId: s.orgId, platform: p.data.platform, storeUrl: base, credentialsEnc: encryptJson(creds), credentialsHint: hint, warehouseId: wh.id });
  await audit({ actorUserId: s.userId, actorKind: "customer", orgId: s.orgId, action: "store.connect", targetType: "store_connection", targetId: id, details: { platform: p.data.platform, host: new URL(base).host } });
  return NextResponse.json({ id, message }, { status: 201 });
}

const Settings = z.object({ id: z.string(), warehouseId: z.string().optional(), autoSync: z.boolean().optional(), pushTracking: z.boolean().optional(),
  defaultPackage: z.object({ lengthCm: z.number().positive().max(300), breadthCm: z.number().positive().max(300), heightCm: z.number().positive().max(300), weightKg: z.number().positive().max(100) }).optional() });

export async function PATCH(req: Request) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const p = await parseJson(req, Settings);
  if (!p.ok) return p.res;
  const db = await getDb();
  if (p.data.warehouseId) {
    const [wh] = await db.select().from(schema.warehouses).where(and(eq(schema.warehouses.id, p.data.warehouseId), eq(schema.warehouses.orgId, s.orgId)));
    if (!wh) return apiError(422, "validation_error", "Unknown pickup address");
  }
  const { id, ...set } = p.data;
  const r = await db.update(schema.storeConnections).set(set).where(and(eq(schema.storeConnections.id, id), eq(schema.storeConnections.orgId, s.orgId))).returning({ id: schema.storeConnections.id });
  if (!r.length) return apiError(404, "not_found", "Store not found");
  return NextResponse.json({ ok: true });
}

/** Disconnect: deletes stored credentials; imported orders and history stay. */
export async function DELETE(req: Request) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const id = new URL(req.url).searchParams.get("id") ?? "";
  const db = await getDb();
  const r = await db.update(schema.storeConnections).set({ status: "disconnected", credentialsEnc: encryptJson({}), autoSync: false })
    .where(and(eq(schema.storeConnections.id, id), eq(schema.storeConnections.orgId, s.orgId))).returning({ id: schema.storeConnections.id });
  if (!r.length) return apiError(404, "not_found", "Store not found");
  await audit({ actorUserId: s.userId, actorKind: "customer", orgId: s.orgId, action: "store.disconnect", targetType: "store_connection", targetId: id });
  return NextResponse.json({ ok: true });
}
