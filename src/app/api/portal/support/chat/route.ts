import { NextResponse } from "next/server";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/server/audit";
import { apiCustomer } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { apiError, parseJson } from "@/server/http";
import { newId } from "@/server/util/ids";

/** Support chat: a message continues the customer's open chat ticket, or opens a new one (VT…). */
export async function POST(req: Request) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const p = await parseJson(req, z.object({ message: z.string().trim().min(2, "Type a message").max(2000) }));
  if (!p.ok) return p.res;
  const db = await getDb();
  const [open] = await db.select({ id: schema.tickets.id }).from(schema.tickets)
    .where(and(eq(schema.tickets.orgId, s.orgId), eq(schema.tickets.category, "chat"), inArray(schema.tickets.status, ["open", "pending", "in_progress"])))
    .orderBy(desc(schema.tickets.createdAt)).limit(1);
  let ticketId = open?.id;
  if (!ticketId) {
    const [{ n }] = await db.select({ n: count() }).from(schema.tickets);
    ticketId = newId("tkt");
    await db.insert(schema.tickets).values({ id: ticketId, orgId: s.orgId, number: `VT${String(10001 + Number(n))}`, category: "chat", subject: p.data.message.slice(0, 80) });
    await audit({ actorUserId: s.userId, actorKind: "customer", orgId: s.orgId, action: "ticket.create", targetType: "ticket", targetId: ticketId, details: { via: "chat" } });
  }
  await db.insert(schema.ticketMessages).values({ id: newId("tm"), ticketId, authorUserId: s.userId, authorKind: "customer", body: p.data.message });
  await db.update(schema.tickets).set({ status: "open", updatedAt: new Date() }).where(eq(schema.tickets.id, ticketId));
  return NextResponse.json({ ticketId });
}
