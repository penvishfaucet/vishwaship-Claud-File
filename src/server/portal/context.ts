import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { cache } from "react";
import { getDb, schema } from "@/server/db/client";
import { requireCustomer } from "@/server/auth/session";

/**
 * Every customer page and API resolves the tenant from the session here. Query helpers below take
 * orgId as their first argument; nothing reads an org id from the URL or request body.
 */
export const portalContext = cache(async () => {
  const s = await requireCustomer();
  const db = await getDb();
  const [org] = await db.select().from(schema.orgs).where(eq(schema.orgs.id, s.orgId));
  const [wallet] = await db.select().from(schema.wallets).where(eq(schema.wallets.orgId, s.orgId));
  const [credits] = await db.select().from(schema.creditBalances).where(eq(schema.creditBalances.orgId, s.orgId));
  const alerts = await db.select().from(schema.inAppAlerts)
    .where(and(eq(schema.inAppAlerts.orgId, s.orgId), isNull(schema.inAppAlerts.readAt)))
    .orderBy(desc(schema.inAppAlerts.createdAt)).limit(10);
  return {
    session: s,
    org,
    walletId: wallet?.id ?? null,
    walletAvailable: wallet ? wallet.postedPaise - wallet.reservedPaise : 0,
    walletPosted: wallet?.postedPaise ?? 0,
    walletReserved: wallet?.reservedPaise ?? 0,
    credits: credits?.credits ?? 0,
    alerts,
  };
});
