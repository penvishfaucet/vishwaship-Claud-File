import { NextResponse } from "next/server";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import { apiCustomer } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db/client";
import { apiError, parseJson } from "@/server/http";

/** Move orders to / from the Archive tab. Hides only; nothing is deleted or cancelled. */
export async function POST(req: Request) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const p = await parseJson(req, z.object({ ids: z.array(z.string().min(4).max(64)).min(1).max(200), archive: z.boolean() }));
  if (!p.ok) return p.res;
  const db = await getDb();
  const done = await db.update(schema.orders).set({ archivedAt: p.data.archive ? new Date() : null })
    .where(and(eq(schema.orders.orgId, s.orgId), inArray(schema.orders.id, p.data.ids), p.data.archive ? isNull(schema.orders.archivedAt) : isNotNull(schema.orders.archivedAt)))
    .returning({ id: schema.orders.id });
  for (const d of done) {
    await audit({ actorUserId: s.userId, actorKind: s.impersonatorId ? "staff" : "customer", orgId: s.orgId, action: p.data.archive ? "order.archive" : "order.unarchive", targetType: "order", targetId: d.id });
  }
  return NextResponse.json({ ok: true, count: done.length });
}
