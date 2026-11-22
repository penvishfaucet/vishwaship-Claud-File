import { NextResponse } from "next/server";
import { apiStaff } from "@/server/auth/session";
import { apiError } from "@/server/http";
import { codHistory } from "@/server/orders/detail-views";

/** Admin → Orders: WhatsApp COD confirmation history of any account's order (staff with shipments.read). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiStaff("shipments.read");
  if (!s) return apiError(403, "forbidden", "You don't have permission to view orders");
  const { id } = await params;
  const h = await codHistory(id, null);
  return h ? NextResponse.json(h) : apiError(404, "not_found", "Order not found");
}
