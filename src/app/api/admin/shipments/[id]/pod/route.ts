import { NextResponse } from "next/server";
import { audit } from "@/server/audit";
import { apiStaff } from "@/server/auth/session";
import { apiError } from "@/server/http";
import { rateLimit } from "@/server/security/rate-limit";
import { fetchPod } from "@/server/tracking/pod";
import { podResponse } from "@/server/tracking/pod-http";

/** Admin: view / download any shipment's stored POD (shipments.read). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiStaff("shipments.read");
  if (!s) return apiError(403, "forbidden", "You don't have permission to view PODs");
  const { id } = await params;
  const r = await podResponse(id, null, new URL(req.url));
  return r ?? apiError(404, "not_found", "Proof of Delivery is not available for this shipment");
}

/** Admin: ask the courier for the POD again now (shipments.write). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiStaff("shipments.write");
  if (!s) return apiError(403, "forbidden", "You don't have permission to fetch PODs");
  const { id } = await params;
  const rl = await rateLimit(`podfetch:${id}`, 4, 300);
  if (!rl.ok) return apiError(429, "rate_limited", "Tried recently — try again in a few minutes");
  const state = await fetchPod(id, { force: true });
  await audit({ actorUserId: s.userId, actorKind: "staff", action: "pod.fetch", targetType: "shipment", targetId: id, details: { state } });
  return NextResponse.json({ state });
}
