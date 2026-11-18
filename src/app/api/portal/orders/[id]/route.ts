import { NextResponse } from "next/server";
import { audit } from "@/server/audit";
import { apiCustomer } from "@/server/auth/session";
import { apiError, parseJson } from "@/server/http";
import { OrderInput, updateOrder } from "@/server/orders/create";
import { setOrderTags } from "@/server/orders/extras";

/** Save changes to a draft / unbooked order (Create Shipment: Save as Draft, Save, Save & Assign Courier). */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const { id } = await params;
  const extra = (await req.clone().json().catch(() => ({}))) as { tagIds?: unknown };
  const p = await parseJson(req, OrderInput);
  if (!p.ok) return p.res;
  const r = await updateOrder(s.orgId, id, p.data);
  if (!r.ok) return apiError(409, "conflict", r.message);
  if (Array.isArray(extra.tagIds)) await setOrderTags(s.orgId, r.orderId, extra.tagIds.filter((x): x is string => typeof x === "string"));
  await audit({ actorUserId: s.userId, actorKind: s.impersonatorId ? "staff" : "customer", orgId: s.orgId, action: "order.update", targetType: "order", targetId: r.orderId, details: { saveAs: p.data.saveAs ?? "ready" } });
  return NextResponse.json(r);
}
