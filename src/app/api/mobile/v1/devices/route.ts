import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/server/db/client";
import { apiError, parseJson } from "@/server/http";
import { isMobileRequest } from "@/server/mobile/auth";
import { mobileJson, withCustomer } from "@/server/mobile/http";

/** Register / update this install's push token (null = notifications turned off). Bound to the current session only. */
export async function PUT(req: Request) {
  if (!isMobileRequest(req)) return apiError(400, "validation_error", "App token required");
  return withCustomer(async (s) => {
    const p = await parseJson(req, z.object({ pushToken: z.string().min(20).max(4096).nullable(), appVersion: z.string().max(40).optional() }));
    if (!p.ok) return p.res;
    const db = await getDb();
    const r = await db.update(schema.mobileDevices)
      .set({ pushToken: p.data.pushToken, pushEnabled: !!p.data.pushToken, lastSeenAt: new Date(), ...(p.data.appVersion ? { appVersion: p.data.appVersion } : {}) })
      .where(and(eq(schema.mobileDevices.sessionId, s.sessionId), eq(schema.mobileDevices.userId, s.userId), isNull(schema.mobileDevices.revokedAt)))
      .returning({ id: schema.mobileDevices.id });
    if (!r.length) return apiError(409, "conflict", "Sign in again to turn on notifications on this device");
    // the same FCM token must never stay on another install or account
    if (p.data.pushToken) {
      const others = await db.select({ id: schema.mobileDevices.id }).from(schema.mobileDevices).where(eq(schema.mobileDevices.pushToken, p.data.pushToken));
      for (const o of others) if (o.id !== r[0].id) await db.update(schema.mobileDevices).set({ pushToken: null, pushEnabled: false }).where(eq(schema.mobileDevices.id, o.id));
    }
    return mobileJson({ ok: true });
  });
}
