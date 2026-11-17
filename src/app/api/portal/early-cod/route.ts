import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { apiCustomer } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db/client";
import { earlyCodState } from "@/server/early-cod";
import { apiError, parseJson } from "@/server/http";
import { newId } from "@/server/util/ids";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("subscribe"), acceptTerms: z.literal(true, { errorMap: () => ({ message: "Accept the Early COD terms to subscribe" }) }), termsVersion: z.number().int() }),
  z.object({ action: z.literal("cancel") }),
]);

/** Subscribe to / cancel Early COD. Eligibility and terms are checked on the server; terms are snapshotted. */
export async function POST(req: Request) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const p = await parseJson(req, Body);
  if (!p.ok) return p.res;
  const st = await earlyCodState(s.orgId);
  const db = await getDb();
  const kind = s.impersonatorId ? "staff" : "customer";
  if (p.data.action === "cancel") {
    if (!st.sub) return apiError(409, "conflict", "You do not have an active Early COD subscription");
    await db.update(schema.earlyCodSubscriptions).set({ status: "cancelled", cancelledAt: new Date() }).where(and(eq(schema.earlyCodSubscriptions.orgId, s.orgId), eq(schema.earlyCodSubscriptions.status, "active")));
    await audit({ actorUserId: s.userId, actorKind: kind, orgId: s.orgId, action: "early_cod.cancel" });
    return NextResponse.json({ ok: true, message: "Early COD cancelled. Future payouts follow the standard cycle." });
  }
  if (st.sub) return apiError(409, "conflict", "Early COD is already active");
  if (!st.eligible) return apiError(403, "forbidden", st.reasons.join(" "));
  if (p.data.termsVersion !== st.terms.version) return apiError(409, "conflict", "The terms were just updated. Review them and try again.");
  await db.insert(schema.earlyCodSubscriptions).values({ id: newId("ecod"), orgId: s.orgId, status: "active", feeBps: st.terms.feeBps, cycleDays: st.terms.cycleDays, termsVersion: st.terms.version });
  await audit({ actorUserId: s.userId, actorKind: kind, orgId: s.orgId, action: "early_cod.subscribe", details: { feeBps: st.terms.feeBps, cycleDays: st.terms.cycleDays, termsVersion: st.terms.version } });
  return NextResponse.json({ ok: true, message: "Early COD is active." });
}
