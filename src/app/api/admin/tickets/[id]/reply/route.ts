import { NextResponse } from "next/server";
import { audit } from "@/server/audit";
import { apiStaff } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { apiError } from "@/server/http";
import { field, fileField, ticketErrorResponse } from "@/server/support/http";
import { addMessage } from "@/server/support/tickets";
import { newId } from "@/server/util/ids";

/** Support staff reply (text and/or file) and status change: open / resolved / closed. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiStaff("tickets.write");
  if (!s) return apiError(403, "forbidden", "Not allowed");
  const { id } = await params;
  const fd = await req.formData().catch(() => null);
  if (!fd) return apiError(400, "validation_error", "Could not read the reply");
  const cid = field(fd, "cid");
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(cid)) return apiError(400, "validation_error", "Missing message key, reload the page");
  const st = field(fd, "status");
  const status = st === "open" || st === "resolved" || st === "closed" ? st : undefined;
  try {
    const r = await addMessage({ ticketId: id, userId: s.userId, authorKind: "staff", body: field(fd, "body"), file: fileField(fd, "file"), clientId: cid, status });
    if (!r.replay && r.orgId) {
      const db = await getDb();
      await db.insert(schema.inAppAlerts).values({ id: newId("al"), orgId: r.orgId, kind: "ticket", title: `Ticket ${r.number} ${r.id ? "has a new reply" : `is ${r.status}`}`, href: `/portal/support/${id}/` });
      await audit({ actorUserId: s.userId, actorKind: "staff", orgId: r.orgId, action: "ticket.reply", targetType: "ticket", targetId: id, details: { status: r.status, message: !!r.id } });
    }
    return NextResponse.json({ id: r.id, replay: r.replay, status: r.status });
  } catch (e) {
    return ticketErrorResponse(e) ?? apiError(500, "internal_error", "Could not send the reply");
  }
}
