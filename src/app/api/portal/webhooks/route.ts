import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { apiCustomer } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db/client";
import { apiError, parseJson } from "@/server/http";
import { encrypt } from "@/server/security/crypto";
import { BlockedUrlError, vetUrl } from "@/server/security/safe-fetch";
import { newId, randomToken } from "@/server/util/ids";
import { NOTIFY_EVENTS } from "@/server/notifications/events";
import { deliver } from "@/server/webhooks/outbound";

/** Save endpoint (validates https + SSRF rules). A new signing secret is returned once. */
export async function PUT(req: Request) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const p = await parseJson(req, z.object({ url: z.string().url().max(500) }));
  if (!p.ok) return p.res;
  try { await vetUrl(p.data.url); } catch (e) { if (e instanceof BlockedUrlError) return apiError(422, "validation_error", e.message); throw e; }
  const db = await getDb();
  const [existing] = await db.select().from(schema.webhookEndpoints).where(eq(schema.webhookEndpoints.orgId, s.orgId));
  let secret: string | undefined;
  if (existing) {
    await db.update(schema.webhookEndpoints).set({ url: p.data.url }).where(eq(schema.webhookEndpoints.id, existing.id));
  } else {
    secret = `whsec_${randomToken(24)}`;
    await db.insert(schema.webhookEndpoints).values({ id: newId("whe"), orgId: s.orgId, url: p.data.url, secretEnc: encrypt(secret), events: NOTIFY_EVENTS.map((e) => e.key) });
  }
  await audit({ actorUserId: s.userId, actorKind: "customer", orgId: s.orgId, action: "webhook.endpoint_saved", details: { host: new URL(p.data.url).host } });
  return NextResponse.json({ message: "Endpoint saved.", secret });
}

/** Send a signed test event. */
export async function PATCH() {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const db = await getDb();
  const [ep] = await db.select().from(schema.webhookEndpoints).where(eq(schema.webhookEndpoints.orgId, s.orgId));
  if (!ep) return apiError(404, "not_found", "Save an endpoint first");
  const r = await deliver(ep.id, newId("evt_test"), "test.ping", { message: "Test event from Vishwaship" });
  return r.ok ? NextResponse.json({ message: r.message }) : apiError(502, "provider_error", r.message);
}
