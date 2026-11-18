import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { apiCustomer } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { apiError } from "@/server/http";
import { field, fileField, ticketErrorResponse } from "@/server/support/http";
import { addMessage } from "@/server/support/tickets";

/** Customer reply in a ticket thread (multipart: body, file, cid). Own tickets only; a retried send is not duplicated. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const { id } = await params;
  const db = await getDb();
  const [own] = await db.select({ id: schema.tickets.id }).from(schema.tickets).where(and(eq(schema.tickets.id, id), eq(schema.tickets.orgId, s.orgId)));
  if (!own) return apiError(404, "not_found", "Ticket not found");
  const fd = await req.formData().catch(() => null);
  if (!fd) return apiError(400, "validation_error", "Could not read the message");
  const cid = field(fd, "cid");
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(cid)) return apiError(400, "validation_error", "Missing message key, reload the page");
  try {
    const r = await addMessage({ ticketId: id, userId: s.userId, authorKind: "customer", body: field(fd, "body"), file: fileField(fd, "file"), clientId: cid });
    return NextResponse.json({ id: r.id, replay: r.replay });
  } catch (e) {
    return ticketErrorResponse(e) ?? apiError(500, "internal_error", "Could not send, please try again");
  }
}
