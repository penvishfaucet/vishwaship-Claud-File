import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { audit } from "@/server/audit";
import { apiCustomer } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { apiError } from "@/server/http";
import { createOrder } from "@/server/orders/create";

/** Clone an order into a new draft (new order ID, same buyer, products and packages) and open it for editing. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const { id } = await params;
  const db = await getDb();
  const [o] = await db.select().from(schema.orders).where(and(eq(schema.orders.id, id), eq(schema.orders.orgId, s.orgId)));
  if (!o) return apiError(404, "not_found", "Order not found");
  const [wh] = o.warehouseId ? await db.select().from(schema.warehouses).where(and(eq(schema.warehouses.id, o.warehouseId), eq(schema.warehouses.active, true))) : [];
  const [fallback] = wh ? [wh] : await db.select().from(schema.warehouses).where(and(eq(schema.warehouses.orgId, s.orgId), eq(schema.warehouses.active, true)));
  if (!fallback) return apiError(409, "conflict", "Add an active pickup address first");
  const pk = await db.select().from(schema.packages).where(eq(schema.packages.orderId, o.id));
  const c = o.consignee as { name: string; mobile: string; email?: string; line1: string; line2?: string; pincode: string; city: string; state: string };
  const products = (o.products as Array<{ name: string; sku?: string; qty: number; unitPrice: number; hsn?: string }>);
  const r = await createOrder(s.orgId, {
    mode: o.mode === "B2B" ? "B2B" : "B2C", direction: o.direction === "reverse" ? "reverse" : "forward", paymentType: (["prepaid", "cod", "fod"].includes(o.paymentType) ? o.paymentType : "prepaid") as "prepaid" | "cod" | "fod",
    codAmountRupees: o.codAmountPaise / 100, declaredValueRupees: o.declaredValuePaise / 100, warehouseId: fallback.id, saveAs: "draft",
    consignee: { name: c.name, mobile: c.mobile, email: c.email || undefined, line1: c.line1, line2: c.line2 || undefined, pincode: c.pincode, city: c.city, state: c.state },
    products: (products.length ? products : [{ name: "Item", qty: 1, unitPrice: 0 }]).map((p) => ({ name: p.name, sku: p.sku, qty: p.qty, unitPriceRupees: p.unitPrice / 100, hsn: p.hsn })),
    packages: (pk.length ? pk : [{ count: 1, lengthMm: 200, breadthMm: 150, heightMm: 100, actualWeightGrams: 500 }]).map((p) => ({ count: p.count, lengthCm: p.lengthMm / 10, breadthCm: p.breadthMm / 10, heightCm: p.heightMm / 10, weightKg: p.actualWeightGrams / 1000 })),
    invoiceNumber: o.invoiceNumber ?? undefined, ewayBill: o.ewayBill ?? undefined,
  });
  if (!r.ok) return apiError(409, "conflict", r.message);
  await audit({ actorUserId: s.userId, actorKind: s.impersonatorId ? "staff" : "customer", orgId: s.orgId, action: "order.clone", targetType: "order", targetId: r.orderId, details: { from: o.id } });
  return NextResponse.json({ orderId: r.orderId, orderNumber: r.orderNumber, editUrl: `/portal/orders/new/?draft=${r.orderId}` }, { status: 201 });
}
