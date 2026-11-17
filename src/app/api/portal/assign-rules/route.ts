import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { apiCustomer } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { RuleInput } from "@/server/auto-assign";
import { getDb, schema } from "@/server/db/client";
import { hasFeature } from "@/server/features";
import { apiError, parseJson } from "@/server/http";
import { newId } from "@/server/util/ids";

async function guard() {
  const s = await apiCustomer();
  if (!s) return { err: apiError(401, "unauthorized", "Please log in") } as const;
  if (!(await hasFeature(s.orgId, "auto_assign"))) return { err: apiError(403, "forbidden", "Auto-assign is not enabled for your account") } as const;
  return { s } as const;
}
const actorKind = (s: { impersonatorId: string | null }): "staff" | "customer" => (s.impersonatorId ? "staff" : "customer");

export async function POST(req: Request) {
  const g = await guard(); if ("err" in g) return g.err;
  const p = await parseJson(req, RuleInput.extend({ id: z.string().optional() }));
  if (!p.ok) return p.res;
  const db = await getDb();
  const { id, ...v } = p.data;
  if (v.conditions.warehouseId) {
    const [w] = await db.select({ id: schema.warehouses.id }).from(schema.warehouses).where(and(eq(schema.warehouses.id, v.conditions.warehouseId), eq(schema.warehouses.orgId, g.s.orgId)));
    if (!w) return apiError(422, "validation_error", "Unknown warehouse");
  }
  if (id) {
    const upd = await db.update(schema.assignRules).set({ ...v, updatedAt: new Date() }).where(and(eq(schema.assignRules.id, id), eq(schema.assignRules.orgId, g.s.orgId))).returning({ id: schema.assignRules.id });
    if (!upd.length) return apiError(404, "not_found", "Rule not found");
  } else {
    await db.insert(schema.assignRules).values({ id: newId("ar"), orgId: g.s.orgId, ...v });
  }
  await audit({ actorUserId: g.s.userId, actorKind: actorKind(g.s), orgId: g.s.orgId, action: id ? "assign_rule.update" : "assign_rule.create", targetType: "assign_rule", targetId: id ?? v.name, details: v });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: Request) {
  const g = await guard(); if ("err" in g) return g.err;
  const p = await parseJson(req, z.object({ id: z.string() }));
  if (!p.ok) return p.res;
  const db = await getDb();
  const del = await db.delete(schema.assignRules).where(and(eq(schema.assignRules.id, p.data.id), eq(schema.assignRules.orgId, g.s.orgId))).returning({ id: schema.assignRules.id });
  if (!del.length) return apiError(404, "not_found", "Rule not found");
  await audit({ actorUserId: g.s.userId, actorKind: actorKind(g.s), orgId: g.s.orgId, action: "assign_rule.delete", targetType: "assign_rule", targetId: p.data.id });
  return NextResponse.json({ ok: true });
}
