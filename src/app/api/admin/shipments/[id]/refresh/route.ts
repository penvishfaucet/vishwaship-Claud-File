import { NextResponse } from "next/server";
import { audit } from "@/server/audit";
import { apiStaff } from "@/server/auth/session";
import { apiError } from "@/server/http";
import { rateLimit } from "@/server/security/rate-limit";
import { refreshFromCarrier } from "@/server/tracking/service";

/** Admin → Orders: pull the latest courier scans for one shipment now (staff with shipments.write). Read-only towards the courier. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiStaff("shipments.write");
  if (!s) return apiError(403, "forbidden", "You don't have permission to refresh tracking");
  const { id } = await params;
  const rl = await rateLimit(`trkrefresh:${id}`, 6, 300);
  if (!rl.ok) return apiError(429, "rate_limited", "Refreshed recently — try again in a few minutes");
  const r = await refreshFromCarrier(id);
  await audit({ actorUserId: s.userId, actorKind: "staff", action: "tracking.retry_sync", targetType: "shipment", targetId: id, details: { ok: r.ok } });
  return r.ok ? NextResponse.json(r) : apiError(502, "provider_error", r.message);
}
