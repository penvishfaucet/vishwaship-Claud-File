import { NextResponse } from "next/server";
import { z } from "zod";
import { apiCustomer } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { autoAssign } from "@/server/auto-assign";
import { bookOrder } from "@/server/booking/service";
import { hasFeature } from "@/server/features";
import { apiError, parseJson } from "@/server/http";

/** Pick a courier with the account's Auto-Assign rules (and optionally book it). Always returns the reason. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  if (!(await hasFeature(s.orgId, "auto_assign"))) return apiError(403, "forbidden", "Auto-assign is not enabled for your account");
  const p = await parseJson(req, z.object({ book: z.boolean().default(false) }));
  if (!p.ok) return p.res;
  const { id } = await params;
  const pick = await autoAssign(s.orgId, id);
  if (!pick.ok) return pick.message === "Order not found" ? apiError(404, "not_found", pick.message) : apiError(422, "validation_error", pick.message);
  const out = { quoteId: pick.offer.quoteId, carrierName: pick.offer.carrierName, serviceName: pick.offer.serviceName, total: pick.offer.total, reason: pick.reason };
  await audit({ actorUserId: s.userId, actorKind: s.impersonatorId ? "staff" : "customer", orgId: s.orgId, action: "order.auto_assign", targetType: "order", targetId: id, details: { carrier: pick.offer.carrierCode, rule: pick.ruleId, reason: pick.reason } });
  if (!p.data.book) return NextResponse.json(out);
  const b = await bookOrder({ orgId: s.orgId, orderId: id, quoteId: pick.offer.quoteId, actorUserId: s.userId });
  if (!b.ok) return NextResponse.json({ ...out, booked: false, error: b.message }, { status: 409 });
  return NextResponse.json({ ...out, booked: true, booking: b });
}
