import { NextResponse } from "next/server";
import { apiCustomer } from "@/server/auth/session";
import { apiError } from "@/server/http";
import { codHistory } from "@/server/orders/detail-views";

/** WhatsApp COD confirmation history for one of this account's orders: messages, buyer reply, cancellation, refund. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const { id } = await params;
  const h = await codHistory(id, s.orgId);
  return h ? NextResponse.json(h) : apiError(404, "not_found", "Order not found");
}
