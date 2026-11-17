import { NextResponse } from "next/server";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import { apiCustomer } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { apiError } from "@/server/http";
import { rateLimit } from "@/server/security/rate-limit";

/** Quick Search: the signed-in account's own orders by order ID, AWB or LR (max 8). */
export async function GET(req: Request) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 40);
  if (q.length < 3) return NextResponse.json({ results: [] });
  const rl = await rateLimit(`qs:${s.userId}`, 120, 60);
  if (!rl.ok) return apiError(429, "rate_limited", "Too many searches");
  const db = await getDb();
  const like = `%${q.replace(/[%_\\]/g, (m) => "\\" + m)}%`;
  const rows = await db.select({ id: schema.orders.id, orderNumber: schema.orders.orderNumber, status: schema.orders.status, awb: schema.shipments.awb, lr: schema.shipments.lrNumber, shipStatus: schema.shipments.status })
    .from(schema.orders).leftJoin(schema.shipments, eq(schema.shipments.orderId, schema.orders.id))
    .where(and(eq(schema.orders.orgId, s.orgId), or(ilike(schema.orders.orderNumber, like), ilike(schema.shipments.awb, like), ilike(schema.shipments.lrNumber, like))))
    .orderBy(desc(schema.orders.createdAt)).limit(8);
  return NextResponse.json({ results: rows.map((r) => ({ href: `/portal/orders/${r.id}/`, title: r.orderNumber, sub: [r.awb && `AWB ${r.awb}`, r.lr && `LR ${r.lr}`, (r.shipStatus ?? r.status).replace(/_/g, " ")].filter(Boolean).join(" · ") })) });
}
