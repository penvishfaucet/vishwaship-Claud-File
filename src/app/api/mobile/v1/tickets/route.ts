import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { mobileJson, withCustomer } from "@/server/mobile/http";

/** My Tickets (create with POST /api/portal/support/tickets, reply with …/messages). */
export async function GET() {
  return withCustomer(async (s) => {
    const db = await getDb();
    const rows = await db.select().from(schema.tickets).where(eq(schema.tickets.orgId, s.orgId)).orderBy(desc(schema.tickets.updatedAt)).limit(200);
    return mobileJson({ tickets: rows.map((t) => ({ id: t.id, number: t.number, category: t.category, subject: t.subject, status: t.status, orderId: t.orderId, orderNumber: t.orderNumber, awb: t.awb, createdAt: t.createdAt.toISOString(), updatedAt: t.updatedAt.toISOString() })) });
  });
}
