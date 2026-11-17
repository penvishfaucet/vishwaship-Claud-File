import { presentNotices, presentOffer } from "@/server/quotes/present";
import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { apiCustomer } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { apiError } from "@/server/http";
import { getQuotes } from "@/server/quotes/service";

/** Quote an existing (imported / unbooked) order from its stored details. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const { id } = await params;
  const db = await getDb();
  const [o] = await db.select().from(schema.orders).where(and(eq(schema.orders.id, id), eq(schema.orders.orgId, s.orgId)));
  if (!o) return apiError(404, "not_found", "Order not found");
  const [wh] = o.warehouseId ? await db.select().from(schema.warehouses).where(eq(schema.warehouses.id, o.warehouseId)) : [];
  if (!wh) return apiError(422, "validation_error", "Order has no pickup address");
  const pk = await db.select().from(schema.packages).where(eq(schema.packages.orderId, id));
  const c = o.consignee as { pincode: string };
  const { offers, errors } = await getQuotes({
    mode: o.mode as "B2C" | "B2B", originPincode: wh.pincode, destinationPincode: c.pincode, paymentType: o.paymentType as "prepaid" | "cod" | "fod",
    codAmount: o.codAmountPaise, declaredValue: o.declaredValuePaise, direction: o.direction as "forward" | "reverse",
    packages: pk.map((p) => ({ count: p.count, lengthMm: p.lengthMm, breadthMm: p.breadthMm, heightMm: p.heightMm, actualWeightGrams: p.actualWeightGrams })),
  }, s.orgId);
  return NextResponse.json({ offers: offers.map(presentOffer), notices: presentNotices(errors) });
}
