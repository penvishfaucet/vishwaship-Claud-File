import { NextResponse } from "next/server";
import { audit } from "@/server/audit";
import { apiCustomer } from "@/server/auth/session";
import { apiError } from "@/server/http";
import { createOrderFromForm } from "@/server/orders/create-form";

/** Create Order form (portal). Repeated taps carry the same Order ID, so a second save returns the first order. */
export async function POST(req: Request) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const raw = await req.json().catch(() => null);
  if (!raw) return apiError(400, "validation_error", "Could not read the form");
  const r = await createOrderFromForm(s.orgId, raw);
  if (!r.ok) {
    if (r.duplicateOf) return NextResponse.json({ orderId: r.duplicateOf, replay: true }, { status: 200 });
    return apiError(r.status, r.status === 409 ? "conflict" : "validation_error", r.message, r.issues ? { issues: r.issues } : undefined);
  }
  await audit({ actorUserId: s.userId, actorKind: s.impersonatorId ? "staff" : "customer", orgId: s.orgId, action: "order.create", targetType: "order", targetId: r.orderId, details: { orderNumber: r.orderNumber, via: "create_order_form" } });
  return NextResponse.json({ orderId: r.orderId, orderNumber: r.orderNumber }, { status: 201 });
}
