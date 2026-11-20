import { and, asc, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { apiError } from "@/server/http";
import { mobileJson, withCustomer } from "@/server/mobile/http";

/** One ticket with its conversation. Attachments download via /api/portal/support/tickets/[id]/files (owner-checked). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withCustomer(async (s) => {
    const db = await getDb();
    const [t] = await db.select().from(schema.tickets).where(and(eq(schema.tickets.id, id), eq(schema.tickets.orgId, s.orgId)));
    if (!t) return apiError(404, "not_found", "Ticket not found");
    const msgs = await db.select().from(schema.ticketMessages).where(eq(schema.ticketMessages.ticketId, t.id)).orderBy(asc(schema.ticketMessages.createdAt));
    return mobileJson({
      ticket: { id: t.id, number: t.number, category: t.category, subject: t.subject, status: t.status, orderId: t.orderId, orderNumber: t.orderNumber, awb: t.awb, createdAt: t.createdAt.toISOString() },
      messages: msgs.map((m) => ({ id: m.id, fromSupport: m.authorKind === "staff", body: m.body, attachments: m.attachments, createdAt: m.createdAt.toISOString() })),
    });
  });
}
