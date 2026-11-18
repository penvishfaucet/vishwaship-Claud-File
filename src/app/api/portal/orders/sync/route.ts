import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { apiCustomer } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { hasFeature } from "@/server/features";
import { apiError } from "@/server/http";
import { rateLimit } from "@/server/security/rate-limit";
import { syncStore } from "@/server/stores/sync";

/** "Sync Orders": pull new orders from every connected store of this account. Safe to repeat (deduped per store order). */
export async function POST() {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  if (!(await hasFeature(s.orgId, "store_channels"))) return apiError(403, "forbidden", "Store channels are not enabled for your account");
  const db = await getDb();
  const stores = await db.select({ id: schema.storeConnections.id, url: schema.storeConnections.storeUrl }).from(schema.storeConnections)
    .where(and(eq(schema.storeConnections.orgId, s.orgId), eq(schema.storeConnections.status, "connected")));
  if (!stores.length) return apiError(422, "validation_error", "No store is connected yet. Connect Shopify or WooCommerce under Integrations.");
  const rl = await rateLimit(`ordersync:${s.orgId}`, 6, 600);
  if (!rl.ok) return apiError(429, "rate_limited", "Orders were synced recently. Try again in a few minutes.");
  const results: Array<{ store: string; ok: boolean; message?: string; counts?: Record<string, number> }> = [];
  for (const st of stores) {
    const r = await syncStore(st.id, { userId: s.userId, kind: "customer" });
    const { ok, ...rest } = r as { ok: boolean; message?: string } & Record<string, unknown>;
    results.push({ store: new URL(st.url).host, ok, message: ok ? undefined : String(rest.message ?? "Sync failed"), counts: ok ? (rest as Record<string, number>) : undefined });
  }
  return NextResponse.json({ ok: results.some((r) => r.ok), results });
}
