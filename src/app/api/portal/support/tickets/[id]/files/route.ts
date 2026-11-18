import { and, eq } from "drizzle-orm";
import { apiCustomer } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { apiError } from "@/server/http";
import { serveAttachment } from "@/server/support/http";

/** Ticket attachment for the customer who owns the ticket (never another account). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const { id } = await params;
  const db = await getDb();
  const [own] = await db.select({ id: schema.tickets.id }).from(schema.tickets).where(and(eq(schema.tickets.id, id), eq(schema.tickets.orgId, s.orgId)));
  if (!own) return apiError(404, "not_found", "File not found");
  return serveAttachment(id, new URL(req.url));
}
