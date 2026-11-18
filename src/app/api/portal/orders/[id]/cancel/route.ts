import { hideProviders } from "@/server/customer-safe";
import { NextResponse } from "next/server";
import { z } from "zod";
import { apiCustomer } from "@/server/auth/session";
import { apiError, parseJson } from "@/server/http";
import { cancelOrder } from "@/server/shipments/cancel";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const p = await parseJson(req, z.object({ reason: z.string().trim().max(200).optional() }));
  if (!p.ok) return p.res;
  const { id } = await params;
  const r = await cancelOrder({ orgId: s.orgId, orderId: id, actorUserId: s.userId, actorKind: s.impersonatorId ? "staff" : "customer", reason: p.data.reason });
  if (!r.ok) return r.state === "not_found" ? apiError(404, "not_found", hideProviders(r.message)) : apiError(r.state === "not_allowed" ? 409 : 502, r.state === "not_allowed" ? "conflict" : "provider_error", hideProviders(r.message));
  return NextResponse.json(r);
}
