import { NextResponse } from "next/server";
import { apiCustomer } from "@/server/auth/session";
import { hasFeature } from "@/server/features";
import { apiError } from "@/server/http";
import { shipmentTimeline } from "@/server/orders/detail-views";

/** Tracking timeline for the Track dialog (own shipments only). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  if (!(await hasFeature(s.orgId, "tracking"))) return apiError(403, "forbidden", "Tracking is not enabled for your account");
  const { id } = await params;
  const t = await shipmentTimeline(id, s.orgId, { customerSafe: true });
  return t ? NextResponse.json(t) : apiError(404, "not_found", "Shipment not found");
}
