import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { MODULES } from "@/lib/modules";
import { audit } from "@/server/audit";
import { apiStaff } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { apiError, parseJson } from "@/server/http";
import { newId } from "@/server/util/ids";

const moduleKey = z.enum(MODULES.map((m) => m.key) as [string, ...string[]]);
const Body = z.discriminatedUnion("op", [
  z.object({ op: z.literal("feature"), orgId: z.string().min(3).nullable(), module: moduleKey, value: z.enum(["on", "off", "inherit"]) }),
  z.object({ op: z.literal("assign"), orgId: z.string().min(3), planId: z.string().min(3), days: z.number().int().min(0).max(3650) }),
  z.object({ op: z.literal("cancel"), orgId: z.string().min(3) }),
]);

/** Admin feature access: global/customer overrides and customer plan activation. Requires modules.manage. */
export async function POST(req: Request) {
  const s = await apiStaff("modules.manage");
  if (!s) return apiError(403, "forbidden", "You cannot change feature access");
  const p = await parseJson(req, Body);
  if (!p.ok) return p.res;
  const db = await getDb();
  const b = p.data;
  if (b.orgId) {
    const [org] = await db.select({ id: schema.orgs.id }).from(schema.orgs).where(eq(schema.orgs.id, b.orgId));
    if (!org) return apiError(404, "not_found", "Customer not found");
  }
  if (b.op === "feature") {
    const scope = b.orgId ? eq(schema.featureOverrides.orgId, b.orgId) : isNull(schema.featureOverrides.orgId);
    await db.delete(schema.featureOverrides).where(and(scope, eq(schema.featureOverrides.module, b.module)));
    if (b.value !== "inherit") await db.insert(schema.featureOverrides).values({ id: newId("fo"), orgId: b.orgId, module: b.module, enabled: b.value === "on", updatedBy: s.userId });
    await audit({ actorUserId: s.userId, actorKind: "staff", orgId: b.orgId ?? undefined, action: "feature.override", targetType: "module", targetId: b.module, details: { scope: b.orgId ? "customer" : "global", value: b.value } });
    return NextResponse.json({ ok: true, message: "Feature updated" });
  }
  if (b.op === "assign") {
    const [plan] = await db.select().from(schema.plans).where(and(eq(schema.plans.id, b.planId), eq(schema.plans.active, true)));
    if (!plan) return apiError(404, "not_found", "Choose an active plan");
    const expiresAt = b.days > 0 ? new Date(Date.now() + b.days * 86400_000) : null;
    await db.transaction(async (tx) => {
      await tx.update(schema.orgSubscriptions).set({ status: "cancelled" }).where(and(eq(schema.orgSubscriptions.orgId, b.orgId), eq(schema.orgSubscriptions.status, "active")));
      await tx.insert(schema.orgSubscriptions).values({ id: newId("sub"), orgId: b.orgId, planId: plan.id, status: "active", expiresAt, createdBy: s.userId });
    });
    await audit({ actorUserId: s.userId, actorKind: "staff", orgId: b.orgId, action: "subscription.activate", targetType: "plan", targetId: plan.id, details: { plan: plan.name, expiresAt } });
    return NextResponse.json({ ok: true, message: `${plan.name} activated` });
  }
  await db.update(schema.orgSubscriptions).set({ status: "cancelled" }).where(and(eq(schema.orgSubscriptions.orgId, b.orgId), eq(schema.orgSubscriptions.status, "active")));
  await audit({ actorUserId: s.userId, actorKind: "staff", orgId: b.orgId, action: "subscription.cancel" });
  return NextResponse.json({ ok: true, message: "Subscription cancelled" });
}
