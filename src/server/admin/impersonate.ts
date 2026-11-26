"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { audit } from "@/server/audit";
import { createSession, destroySession, readSession, requireStaff } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { ipFromHeaders } from "@/server/security/rate-limit";

const IMPERSONATION_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * "Login as customer": owner-only (customers.impersonate). Creates a short-lived customer session
 * for the account's primary user, tagged with the admin's staff id. The admin's own staff session
 * is untouched. Start and end are written to the audit log; the portal shows a banner throughout.
 */
export async function loginAsCustomer(fd: FormData) {
  const s = await requireStaff("customers.impersonate");
  const orgId = String(fd.get("orgId") ?? "");
  const db = await getDb();
  const [org] = await db.select().from(schema.orgs).where(eq(schema.orgs.id, orgId));
  if (!org) redirect("/admin/customers/?err=notfound");
  const [user] = await db.select().from(schema.users)
    .where(and(eq(schema.users.orgId, orgId), eq(schema.users.kind, "customer"), eq(schema.users.active, true)))
    .orderBy(asc(schema.users.createdAt)).limit(1);
  if (!user) redirect(`/admin/customers/${orgId}/?msg=nouser`);
  const h = await headers();
  await createSession(user.id, "customer", {
    ip: ipFromHeaders(h), ua: h.get("user-agent") ?? "",
    impersonatorId: s.userId, ttlMs: IMPERSONATION_TTL_MS,
  });
  await audit({ actorUserId: s.userId, actorKind: "staff", orgId, action: "customer.impersonate_start", targetType: "user", targetId: user.id, details: { business: org.businessName } });
  redirect("/portal/");
}

/** Leave the customer account and go back to that customer's admin page. */
export async function exitCustomerView() {
  const c = await readSession("customer");
  if (c?.impersonatorId) {
    await audit({ actorUserId: c.impersonatorId, actorKind: "staff", orgId: c.orgId, action: "customer.impersonate_end", targetType: "user", targetId: c.userId });
  }
  await destroySession("customer");
  redirect(c?.orgId ? `/admin/customers/${c.orgId}/` : "/admin/customers/");
}
