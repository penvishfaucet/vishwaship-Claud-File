import { NextResponse } from "next/server";
import { hasFeature } from "@/server/features";
import { and, eq } from "drizzle-orm";
import { apiCustomer } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { apiError } from "@/server/http";
import { rateLimit } from "@/server/security/rate-limit";
import { syncStore } from "@/server/stores/sync";

/** Manual "Sync now" / retry. Safe to repeat: dedupe by store + external order id. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  if (!(await hasFeature(s.orgId, "store_channels"))) return apiError(403, "forbidden", "Store channels is not enabled for your account");
  const { id } = await params;
  const db = await getDb();
  const [c] = await db.select({ id: schema.storeConnections.id }).from(schema.storeConnections).where(and(eq(schema.storeConnections.id, id), eq(schema.storeConnections.orgId, s.orgId)));
  if (!c) return apiError(404, "not_found", "Store not found");
  const rl = await rateLimit(`storesync:${id}`, 6, 600);
  if (!rl.ok) return apiError(429, "rate_limited", "Sync was run recently. Try again in a few minutes.");
  const r = await syncStore(id, { userId: s.userId, kind: "customer" });
  return r.ok ? NextResponse.json(r) : apiError(502, "provider_error", r.message);
}
