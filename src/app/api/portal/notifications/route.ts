import { NextResponse } from "next/server";
import { z } from "zod";
import { apiCustomer } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db/client";
import { apiError, parseJson } from "@/server/http";
import { CHANNELS, NOTIFY_EVENTS } from "@/server/notifications/events";
import { newId } from "@/server/util/ids";

const Body = z.object({
  channel: z.enum(CHANNELS),
  event: z.string().refine((e) => e === "*" || e === "cod_confirmation" || NOTIFY_EVENTS.some((x) => x.key === e), "Unknown event"),
  enabled: z.boolean(),
});

export async function PUT(req: Request) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const p = await parseJson(req, Body);
  if (!p.ok) return p.res;
  if (p.data.event === "cod_confirmation" && p.data.channel !== "whatsapp") return apiError(422, "validation_error", "COD confirmation is WhatsApp only");
  const db = await getDb();
  await db.insert(schema.notificationSettings).values({ id: newId("ns"), orgId: s.orgId, channel: p.data.channel, event: p.data.event, enabled: p.data.enabled })
    .onConflictDoUpdate({ target: [schema.notificationSettings.orgId, schema.notificationSettings.channel, schema.notificationSettings.event], set: { enabled: p.data.enabled, updatedAt: new Date() } });
  await audit({ actorUserId: s.userId, actorKind: "customer", orgId: s.orgId, action: "notifications.update", details: p.data });
  return NextResponse.json({ ok: true });
}
