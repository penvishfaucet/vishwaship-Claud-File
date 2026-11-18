import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { apiCustomer } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db/client";
import { apiError, parseJson } from "@/server/http";
import { adapterFor, providerContext } from "@/server/providers/registry";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("reattempt") }),
  z.object({ action: z.literal("rto") }),
  z.object({ action: z.literal("update_address"), line1: z.string().trim().min(5).max(200), mobile: z.string().max(15).optional() }),
]);

/** NDR action -> provider; status only advances to "acknowledged" when the provider acknowledges. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const { id } = await params;
  const p = await parseJson(req, Body);
  if (!p.ok) return p.res;
  const db = await getDb();
  const [row] = await db.select({ c: schema.ndrCases, sh: schema.shipments }).from(schema.ndrCases)
    .innerJoin(schema.shipments, eq(schema.shipments.id, schema.ndrCases.shipmentId))
    .where(and(eq(schema.ndrCases.id, id), eq(schema.ndrCases.orgId, s.orgId)));
  if (!row) return apiError(404, "not_found", "NDR case not found");
  if (row.c.status !== "open") return apiError(409, "conflict", "An action was already requested for this attempt");
  const [acct] = await db.select().from(schema.providerAccounts).where(eq(schema.providerAccounts.id, row.sh.providerAccountId));
  const adapter = acct && adapterFor(acct);
  if (!adapter) return apiError(422, "provider_error", "This courier does not support NDR actions via API. Raise a ticket.");
  const payload = p.data.action === "update_address" ? { line1: p.data.line1, mobile: p.data.mobile } : undefined;
  await db.update(schema.ndrCases).set({ status: "action_requested", requestedAction: p.data.action, requestPayload: payload ?? null }).where(eq(schema.ndrCases.id, id));
  const r = await adapter.ndrAction(await providerContext(acct), { awb: row.sh.awb! }, { kind: p.data.action, payload });
  if (r.ok && r.value.acknowledged) await db.update(schema.ndrCases).set({ status: "acknowledged" }).where(eq(schema.ndrCases.id, id));
  else if (!r.ok) {
    await db.update(schema.ndrCases).set({ status: "open" }).where(eq(schema.ndrCases.id, id));
    return apiError(502, "provider_error", r.error.message);
  }
  await audit({ actorUserId: s.userId, actorKind: "customer", orgId: s.orgId, action: `ndr.${p.data.action}`, targetType: "ndr_case", targetId: id });
  return NextResponse.json({ ok: true });
}
