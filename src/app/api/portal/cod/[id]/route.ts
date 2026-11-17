import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { apiCustomer } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { apiError, parseJson } from "@/server/http";
import { applyDecision, whatsappMode } from "@/server/whatsapp/service";

const Body = z.object({ decision: z.enum(["confirm", "cancel"]), simulate: z.boolean().optional() });

/**
 * Customer action on one of their own COD confirmations:
 *  - release (confirm) / cancel an order that is send_failed / no_response / needs_review;
 *  - `simulate`: pretend the buyer pressed a button. ONLY in local demo mode (no WATI, not production).
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const p = await parseJson(req, Body);
  if (!p.ok) return p.res;
  const { id } = await params;
  const db = await getDb();
  const [c] = await db.select().from(schema.codConfirmations).where(and(eq(schema.codConfirmations.id, id), eq(schema.codConfirmations.orgId, s.orgId)));
  if (!c) return apiError(404, "not_found", "Not found");
  if (p.data.simulate) {
    if ((await whatsappMode()) !== "demo") return apiError(403, "forbidden", "Simulation is only available in demo mode");
    if (c.status !== "pending") return apiError(409, "conflict", "Only a pending confirmation can receive a buyer reply");
  } else if (!["send_failed", "no_response", "needs_review"].includes(c.status)) {
    return apiError(409, "conflict", "This confirmation is waiting for the buyer or already decided");
  }
  const r = await applyDecision({ confirmationId: c.id, decision: p.data.decision, source: p.data.simulate ? "simulator" : "customer", actorUserId: s.userId });
  if (!r.ok) return apiError(409, "conflict", r.message);
  return NextResponse.json(r);
}
