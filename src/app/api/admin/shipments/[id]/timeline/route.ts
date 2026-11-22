import { NextResponse } from "next/server";
import { apiStaff } from "@/server/auth/session";
import { apiError } from "@/server/http";
import { shipmentTimeline } from "@/server/orders/detail-views";

/** Admin → Orders: tracking timeline of any account's shipment (staff with shipments.read). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiStaff("shipments.read");
  if (!s) return apiError(403, "forbidden", "You don't have permission to view shipments");
  const { id } = await params;
  const t = await shipmentTimeline(id, null, { customerSafe: false });
  return t ? NextResponse.json(t) : apiError(404, "not_found", "Shipment not found");
}
