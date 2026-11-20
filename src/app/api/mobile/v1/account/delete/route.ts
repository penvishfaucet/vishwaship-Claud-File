import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db/client";
import { parseJson } from "@/server/http";
import { mobileJson, withCustomer } from "@/server/mobile/http";
import { newId } from "@/server/util/ids";

/**
 * In-app "Delete my account" request (Google Play requirement). It does not delete immediately: staff check
 * pending shipments, wallet balance and COD dues, then close the account. Records the law requires us to keep
 * (invoices, GST, ledger) are retained. While one request is open, a repeat returns the same request.
 */
export async function POST(req: Request) {
  return withCustomer(async (s) => {
    const p = await parseJson(req, z.object({ reason: z.string().trim().max(500).optional() }));
    if (!p.ok) return p.res;
    const db = await getDb();
    const [open] = await db.select().from(schema.accountDeletionRequests)
      .where(and(eq(schema.accountDeletionRequests.userId, s.userId), eq(schema.accountDeletionRequests.status, "requested")));
    if (open) return mobileJson({ id: open.id, status: open.status, createdAt: open.createdAt.toISOString() });
    const id = newId("adr");
    await db.insert(schema.accountDeletionRequests).values({ id, userId: s.userId, orgId: s.orgId, email: s.email ?? "", reason: p.data.reason, source: "app" });
    await db.insert(schema.staffAlerts).values({ id: newId("sa"), kind: "account_deletion", title: "Account deletion requested", href: `/admin/customers/${s.orgId}/`, perm: "customers.write" });
    await audit({ actorUserId: s.userId, actorKind: "customer", orgId: s.orgId, action: "account.deletion_requested", details: { channel: "android" } });
    return mobileJson({ id, status: "requested" }, { status: 201 });
  });
}
