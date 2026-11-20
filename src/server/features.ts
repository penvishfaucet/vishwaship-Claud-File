import "server-only";
import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import { cache } from "react";
import { redirect } from "next/navigation";
import { getDb, schema } from "@/server/db/client";
import { MODULES, type ModuleKey, type NotificationEventKey } from "@/lib/modules";

/** The customer's current active subscription (if any). */
export async function activeSubscription(orgId: string) {
  const db = await getDb();
  const [row] = await db.select({ s: schema.orgSubscriptions, p: schema.plans }).from(schema.orgSubscriptions)
    .innerJoin(schema.plans, eq(schema.plans.id, schema.orgSubscriptions.planId))
    .where(and(eq(schema.orgSubscriptions.orgId, orgId), eq(schema.orgSubscriptions.status, "active"),
      or(isNull(schema.orgSubscriptions.expiresAt), gt(schema.orgSubscriptions.expiresAt, new Date()))))
    .orderBy(desc(schema.orgSubscriptions.startsAt)).limit(1);
  return row ? { subscription: row.s, plan: row.p } : null;
}

/**
 * Resolution order (first match wins):
 *   1. customer override (feature_overrides.org_id = org)
 *   2. active plan includes the module
 *   3. global override (feature_overrides.org_id IS NULL)
 *   4. module default — except modules marked needsPlan, which are off without a plan/override
 */
export const resolveFeatures = cache(async (orgId: string) => {
  const db = await getDb();
  const overrides = await db.select().from(schema.featureOverrides)
    .where(or(eq(schema.featureOverrides.orgId, orgId), isNull(schema.featureOverrides.orgId)));
  const sub = await activeSubscription(orgId);
  const planModules = new Set<string>((sub?.plan.modules as string[] | undefined) ?? []);
  const planEvents = new Set<string>((sub?.plan.events as string[] | undefined) ?? []);
  const result = {} as Record<ModuleKey, { enabled: boolean; source: "customer" | "plan" | "global" | "default" }>;
  for (const m of MODULES) {
    const org = overrides.find((o) => o.orgId === orgId && o.module === m.key);
    const glob = overrides.find((o) => o.orgId === null && o.module === m.key);
    if (org) result[m.key] = { enabled: org.enabled, source: "customer" };
    else if (planModules.has(m.key)) result[m.key] = { enabled: true, source: "plan" };
    else if (m.needsPlan) result[m.key] = { enabled: false, source: "default" };
    else if (glob) result[m.key] = { enabled: glob.enabled, source: "global" };
    else result[m.key] = { enabled: m.default, source: "default" };
  }
  return { modules: result, plan: sub?.plan ?? null, subscription: sub?.subscription ?? null, planEvents };
});

export async function hasFeature(orgId: string, module: ModuleKey) {
  return (await resolveFeatures(orgId)).modules[module].enabled;
}

/** Event is allowed only if the module is on AND the active plan includes the event. */
export async function eventIncluded(orgId: string, event: NotificationEventKey) {
  const f = await resolveFeatures(orgId);
  if (event === "whatsapp:cod_confirmation") {
    const m = f.modules.whatsapp_notifications;
    return !(m.source === "customer" && !m.enabled);
  }
  return f.modules.whatsapp_notifications.enabled && (f.planEvents.has(event) || f.modules.whatsapp_notifications.source === "customer");
}

/** Page guard: send the customer to an upgrade page when a module is not available. */
export async function requireFeature(orgId: string, module: ModuleKey) {
  if (!(await hasFeature(orgId, module))) redirect(`/portal/upgrade/?module=${module}`);
}
