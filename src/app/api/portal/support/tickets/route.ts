import { NextResponse } from "next/server";
import { apiCustomer } from "@/server/auth/session";
import { apiError } from "@/server/http";
import { field, fileField, ticketErrorResponse } from "@/server/support/http";
import { createTicket } from "@/server/support/tickets";

/** Raise Ticket (multipart): category, ref (Order ID / AWB), comment, file, idem. One submission → one ticket. */
export async function POST(req: Request) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const fd = await req.formData().catch(() => null);
  if (!fd) return apiError(400, "validation_error", "Could not read the form");
  const idem = field(fd, "idem");
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(idem)) return apiError(400, "validation_error", "Missing submission key, reload the page");
  try {
    const r = await createTicket({ orgId: s.orgId, userId: s.userId, category: field(fd, "category"), ref: field(fd, "ref"), comment: field(fd, "comment"), file: fileField(fd, "file"), idemKey: idem });
    return NextResponse.json(r, { status: r.replay ? 200 : 201 });
  } catch (e) {
    return ticketErrorResponse(e) ?? apiError(500, "internal_error", "Could not save the ticket, please try again");
  }
}
