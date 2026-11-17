import { NextResponse } from "next/server";
import { apiCustomer } from "@/server/auth/session";
import { apiError, parseJson } from "@/server/http";
import { OrderInput, createOrder } from "@/server/orders/create";

export async function POST(req: Request) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const p = await parseJson(req, OrderInput);
  if (!p.ok) return p.res;
  const r = await createOrder(s.orgId, p.data);
  if (!r.ok) return apiError(409, "conflict", r.message);
  return NextResponse.json(r, { status: 201 });
}
