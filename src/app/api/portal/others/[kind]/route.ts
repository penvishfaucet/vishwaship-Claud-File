import { NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { apiCustomer } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db/client";
import { apiError } from "@/server/http";
import { newId } from "@/server/util/ids";
import { OTHERS, type OthersKind } from "@/lib/others";

/** Create / update / delete buyers, products, packaging presets and order tags — always within the caller's account. */
async function body(req: Request) { try { return await req.json(); } catch { return null; } }
const mm = (cm: number) => Math.round(cm * 10);
const g = (kg: number) => Math.round(kg * 1000);

export async function POST(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const { kind } = await params;
  if (!(kind in OTHERS)) return apiError(404, "not_found", "Unknown section");
  const k = kind as OthersKind;
  const raw = await body(req);
  const id = typeof raw?.id === "string" ? raw.id : null;
  const parsed = OTHERS[k].schema.safeParse(raw);
  if (!parsed.success) return apiError(422, "validation_error", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const v = parsed.data as unknown as Record<string, any>;
  const db = await getDb();
  const now = new Date();
  try {
    if (k === "customers") {
      const addresses = [{ label: "Default", line1: v.line1, line2: v.line2, pincode: v.pincode, city: v.city, state: v.state }];
      if (v.altLine1 && v.altPincode) addresses.push({ label: "Other", line1: v.altLine1, line2: "", pincode: v.altPincode, city: v.altCity, state: v.altState });
      const row = { name: v.name, mobile: v.mobile, email: v.email || null, addresses, notes: v.notes || null, updatedAt: now };
      if (id) { const u = await db.update(schema.buyers).set(row).where(and(eq(schema.buyers.id, id), eq(schema.buyers.orgId, s.orgId))).returning({ id: schema.buyers.id }); if (!u.length) return apiError(404, "not_found", "Not found"); }
      else await db.insert(schema.buyers).values({ id: newId("by"), orgId: s.orgId, ...row });
    } else if (k === "products") {
      const row = { name: v.name, sku: v.sku, unitPricePaise: Math.round(Number(v.priceRupees) * 100), hsn: v.hsn || null, weightGrams: g(v.weightKg), lengthMm: mm(v.lengthCm), breadthMm: mm(v.breadthCm), heightMm: mm(v.heightCm), active: v.active, updatedAt: now };
      if (id) { const u = await db.update(schema.products).set(row).where(and(eq(schema.products.id, id), eq(schema.products.orgId, s.orgId))).returning({ id: schema.products.id }); if (!u.length) return apiError(404, "not_found", "Not found"); }
      else await db.insert(schema.products).values({ id: newId("pr"), orgId: s.orgId, ...row });
    } else if (k === "packaging") {
      const row = { name: v.name, lengthMm: mm(v.lengthCm), breadthMm: mm(v.breadthCm), heightMm: mm(v.heightCm), tareGrams: g(v.tareKg), isDefault: v.isDefault };
      const pid = id ?? newId("pk");
      if (id) { const u = await db.update(schema.packagingPresets).set(row).where(and(eq(schema.packagingPresets.id, id), eq(schema.packagingPresets.orgId, s.orgId))).returning({ id: schema.packagingPresets.id }); if (!u.length) return apiError(404, "not_found", "Not found"); }
      else await db.insert(schema.packagingPresets).values({ id: pid, orgId: s.orgId, ...row });
      if (row.isDefault) await db.update(schema.packagingPresets).set({ isDefault: false }).where(and(eq(schema.packagingPresets.orgId, s.orgId), ne(schema.packagingPresets.id, pid)));
    } else {
      const row = { name: v.name, color: v.color };
      if (id) { const u = await db.update(schema.orderTags).set(row).where(and(eq(schema.orderTags.id, id), eq(schema.orderTags.orgId, s.orgId))).returning({ id: schema.orderTags.id }); if (!u.length) return apiError(404, "not_found", "Not found"); }
      else await db.insert(schema.orderTags).values({ id: newId("tg"), orgId: s.orgId, ...row });
    }
  } catch (e) {
    if (/unique|duplicate/i.test((e as Error).message)) return apiError(409, "conflict", k === "customers" ? "A customer with this mobile already exists" : k === "products" ? "A product with this SKU already exists" : "That name is already used");
    throw e;
  }
  await audit({ actorUserId: s.userId, actorKind: s.impersonatorId ? "staff" : "customer", orgId: s.orgId, action: `${k}.${id ? "update" : "create"}`, targetType: k, targetId: id ?? String(v.name) });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const { kind } = await params;
  const p = z.object({ id: z.string().min(3) }).safeParse(await body(req));
  if (!(kind in OTHERS) || !p.success) return apiError(422, "validation_error", "Invalid request");
  const db = await getDb();
  const id = p.data.id;
  let n = 0;
  if (kind === "customers") n = (await db.delete(schema.buyers).where(and(eq(schema.buyers.id, id), eq(schema.buyers.orgId, s.orgId))).returning({ id: schema.buyers.id })).length;
  else if (kind === "products") n = (await db.delete(schema.products).where(and(eq(schema.products.id, id), eq(schema.products.orgId, s.orgId))).returning({ id: schema.products.id })).length;
  else if (kind === "packaging") n = (await db.delete(schema.packagingPresets).where(and(eq(schema.packagingPresets.id, id), eq(schema.packagingPresets.orgId, s.orgId))).returning({ id: schema.packagingPresets.id })).length;
  else {
    const [t] = await db.select().from(schema.orderTags).where(and(eq(schema.orderTags.id, id), eq(schema.orderTags.orgId, s.orgId)));
    if (t) { await db.delete(schema.orderTagLinks).where(eq(schema.orderTagLinks.tagId, id)); await db.delete(schema.orderTags).where(eq(schema.orderTags.id, id)); n = 1; }
  }
  if (!n) return apiError(404, "not_found", "Not found");
  await audit({ actorUserId: s.userId, actorKind: s.impersonatorId ? "staff" : "customer", orgId: s.orgId, action: `${kind}.delete`, targetType: kind, targetId: id });
  return NextResponse.json({ ok: true });
}
