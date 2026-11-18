import { hideProviders } from "@/server/customer-safe";
import { NextResponse } from "next/server";
import { hasFeature } from "@/server/features";
import { and, eq } from "drizzle-orm";
import { apiCustomer } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { apiError } from "@/server/http";
import { rateLimit } from "@/server/security/rate-limit";
import { refreshFromCarrier } from "@/server/tracking/service";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  if (!(await hasFeature(s.orgId, "tracking"))) return apiError(403, "forbidden", "Tracking is not enabled for your account");
  const { id } = await params;
  const db = await getDb();
  const [own] = await db.select({ id: schema.shipments.id }).from(schema.shipments).where(and(eq(schema.shipments.id, id), eq(schema.shipments.orgId, s.orgId)));
  if (!own) return apiError(404, "not_found", "Shipment not found");
  const rl = await rateLimit(`trkrefresh:${id}`, 6, 300);
  if (!rl.ok) return apiError(429, "rate_limited", "Refreshed recently — try again in a few minutes");
  const r = await refreshFromCarrier(id);
  return r.ok ? NextResponse.json(r) : apiError(502, "provider_error", hideProviders(r.message));
}
