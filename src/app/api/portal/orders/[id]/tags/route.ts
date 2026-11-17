import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { apiCustomer } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { apiError, parseJson } from "@/server/http";
import { setOrderTags } from "@/server/orders/extras";

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const p = await parseJson(req, z.object({ tagIds: z.array(z.string()).max(20) }));
  if (!p.ok) return p.res;
  const { id } = await params;
  const db = await getDb();
  const [o] = await db.select({ id: schema.orders.id }).from(schema.orders).where(and(eq(schema.orders.id, id), eq(schema.orders.orgId, s.orgId)));
  if (!o) return apiError(404, "not_found", "Order not found");
  return NextResponse.json({ ok: true, count: await setOrderTags(s.orgId, id, p.data.tagIds) });
}
