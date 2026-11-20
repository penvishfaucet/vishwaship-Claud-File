import { NextResponse } from "next/server";
import { z } from "zod";
import { apiCustomer } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db/client";
import { apiError, parseJson } from "@/server/http";
import { newId } from "@/server/util/ids";

/** Client switch for AI NDR calling (paid per connected call from notification credits). */
export async function PUT(req: Request) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const p = await parseJson(req, z.object({ enabled: z.boolean() }));
  if (!p.ok) return p.res;
  const db = await getDb();
  await db.insert(schema.notificationSettings).values({ id: newId("ns"), orgId: s.orgId, channel: "voice", event: "ndr_ai_call", enabled: p.data.enabled })
    .onConflictDoUpdate({ target: [schema.notificationSettings.orgId, schema.notificationSettings.channel, schema.notificationSettings.event], set: { enabled: p.data.enabled, updatedAt: new Date() } });
  await audit({ actorUserId: s.userId, actorKind: s.impersonatorId ? "staff" : "customer", orgId: s.orgId, action: "ndr.ai_calling", details: { enabled: p.data.enabled } });
  return NextResponse.json({ ok: true });
}
