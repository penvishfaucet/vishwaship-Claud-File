import { NextResponse } from "next/server";
import { apiKeyAuth, v1Error, withIdempotency } from "@/server/api/auth";
import { OrderInput, createOrder } from "@/server/orders/create";
import { listOrders } from "@/server/portal/queries";

export async function POST(req: Request) {
  const a = await apiKeyAuth(req, "orders:write");
  if (!a.ok) return a.res;
  const raw = await req.text();
  return withIdempotency(req, a.orgId, a.keyId, raw, async () => {
    let body: unknown;
    try { body = JSON.parse(raw); } catch { return { status: 400, body: { error: { code: "validation_error", message: "Body must be JSON" } } }; }
    const p = OrderInput.safeParse(body);
    if (!p.success) return { status: 422, body: { error: { code: "validation_error", message: "Invalid request", issues: p.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) } } };
    const r = await createOrder(a.orgId, p.data, "api");
    if (!r.ok) return { status: 409, body: { error: { code: "conflict", message: r.message } } };
    return { status: 201, body: { data: { id: r.orderId, order_number: r.orderNumber, status: r.codHold ? "cod_hold" : "ready" } } };
  });
}

export async function GET(req: Request) {
  const a = await apiKeyAuth(req, "orders:read");
  if (!a.ok) return a.res;
  const u = new URL(req.url);
  const page = Number(u.searchParams.get("page") ?? 1);
  if (!Number.isInteger(page) || page < 1) return v1Error(422, "validation_error", "page must be a positive integer");
  const d = await listOrders(a.orgId, { q: u.searchParams.get("q") ?? undefined, page, pageSize: 50 });
  return NextResponse.json({
    data: d.rows.map((r) => ({ id: r.orderId, order_number: r.orderNumber, created_at: r.createdAt, shipment_type: r.mode, payment_type: r.paymentType, awb: r.awb, carrier: r.carrierName, status: r.status ?? r.orderStatus })),
    page: d.page, total: d.total,
  });
}
