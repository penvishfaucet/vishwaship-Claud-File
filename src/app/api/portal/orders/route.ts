import { saveBuyerFromConsignee, setOrderTags } from "@/server/orders/extras";
import { audit } from "@/server/audit";
import { NextResponse } from "next/server";
import { apiCustomer } from "@/server/auth/session";
import { apiError, parseJson } from "@/server/http";
import { OrderInput, createOrder } from "@/server/orders/create";

export async function POST(req: Request) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const extra = (await req.clone().json().catch(() => ({}))) as { tagIds?: unknown; saveBuyer?: unknown };
  const p = await parseJson(req, OrderInput);
  if (!p.ok) return p.res;
  const r = await createOrder(s.orgId, p.data);
  if (!r.ok) return apiError(409, "conflict", r.message);
  if (Array.isArray(extra.tagIds)) await setOrderTags(s.orgId, r.orderId, extra.tagIds.filter((x): x is string => typeof x === "string"));
  if (extra.saveBuyer === true) await saveBuyerFromConsignee(s.orgId, p.data.consignee);
  await audit({ actorUserId: s.userId, actorKind: s.impersonatorId ? "staff" : "customer", orgId: s.orgId, action: "order.create", targetType: "order", targetId: r.orderId, details: { orderNumber: r.orderNumber, codHold: r.codHold } });
  return NextResponse.json(r, { status: 201 });
}
