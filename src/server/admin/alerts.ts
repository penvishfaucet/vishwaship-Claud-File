"use server";
import { desc, eq, isNull, or, inArray } from "drizzle-orm";
import { readSession } from "@/server/auth/session";
import { ROLE_PERMISSIONS } from "@/server/auth/rbac";
import { getDb, schema } from "@/server/db/client";

/** Admin bell: latest alerts this staff role may see, how many are new, and pending manual recharges. */
export async function staffBell() {
  const s = await readSession("staff");
  if (!s?.role) return { items: [], unseen: 0, pendingRecharges: 0 };
  const db = await getDb();
  const perms = ROLE_PERMISSIONS[s.role] as string[];
  const items = await db.select().from(schema.staffAlerts).where(or(isNull(schema.staffAlerts.perm), inArray(schema.staffAlerts.perm, perms))).orderBy(desc(schema.staffAlerts.createdAt)).limit(15);
  const [u] = await db.select({ prefs: schema.users.prefs }).from(schema.users).where(eq(schema.users.id, s.userId));
  const seen = new Date(String((u?.prefs as { staffAlertsSeenAt?: string } | null)?.staffAlertsSeenAt ?? 0));
  let pendingRecharges = 0;
  if (perms.includes("finance.read")) {
    const { pendingManualCount } = await import("@/server/payments/recharge");
    pendingRecharges = await pendingManualCount();
  }
  return {
    items: items.map((a) => ({ id: a.id, title: a.title, href: a.href, createdAt: a.createdAt.toISOString(), unseen: a.createdAt > seen })),
    unseen: items.filter((a) => a.createdAt > seen).length,
    pendingRecharges,
  };
}

/** Mark the bell as seen for this staff user. */
export async function markStaffAlertsSeen() {
  const s = await readSession("staff");
  if (!s) return;
  const db = await getDb();
  const [u] = await db.select({ prefs: schema.users.prefs }).from(schema.users).where(eq(schema.users.id, s.userId));
  await db.update(schema.users).set({ prefs: { ...((u?.prefs as object) ?? {}), staffAlertsSeenAt: new Date().toISOString() } }).where(eq(schema.users.id, s.userId));
}
