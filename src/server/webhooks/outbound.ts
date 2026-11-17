import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { decrypt, hmacSha256Hex } from "@/server/security/crypto";
import { safeFetch } from "@/server/security/safe-fetch";
import { newId } from "@/server/util/ids";

/** Signature scheme documented to customers: hex HMAC-SHA256(secret, `${timestamp}.${body}`). */
export function signPayload(secret: string, timestamp: string, body: string) {
  return hmacSha256Hex(secret, `${timestamp}.${body}`);
}

/** Queue + attempt one signed delivery (dedupe per endpoint + event id). Retries are handled by the worker. */
export async function deliver(endpointId: string, eventId: string, eventType: string, data: Record<string, unknown>) {
  const db = await getDb();
  const [ep] = await db.select().from(schema.webhookEndpoints).where(and(eq(schema.webhookEndpoints.id, endpointId), eq(schema.webhookEndpoints.active, true)));
  if (!ep) return { ok: false, status: 0, message: "Endpoint inactive" };
  const payload = { event_id: eventId, type: eventType, version: "2026-11-01", created_at: new Date().toISOString(), data };
  const [row] = await db.insert(schema.webhookDeliveries).values({ id: newId("whd"), endpointId, eventId, eventType, payload, status: "pending" }).onConflictDoNothing().returning();
  if (!row) return { ok: true, status: 0, message: "Already delivered (duplicate event)" };
  const body = JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = signPayload(decrypt(ep.secretEnc), ts, body);
  let status = 0;
  try {
    const r = await safeFetch(ep.url, { method: "POST", timeoutMs: 10_000, headers: { "content-type": "application/json", "user-agent": "Vishwaship-Webhooks/1.0", "x-vishwaship-event-id": eventId, "x-vishwaship-timestamp": ts, "x-vishwaship-signature": sig }, body });
    status = r.status;
  } catch (e) {
    await db.update(schema.webhookDeliveries).set({ status: "failed", attempts: 1, nextAttemptAt: new Date(Date.now() + 60_000) }).where(eq(schema.webhookDeliveries.id, row.id));
    return { ok: false, status: 0, message: (e as Error).message };
  }
  const ok = status >= 200 && status < 300;
  await db.update(schema.webhookDeliveries).set({ status: ok ? "delivered" : "failed", attempts: 1, lastStatusCode: status, nextAttemptAt: ok ? null : new Date(Date.now() + 60_000) }).where(eq(schema.webhookDeliveries.id, row.id));
  return { ok, status, message: ok ? `Delivered (HTTP ${status})` : `Endpoint responded HTTP ${status}` };
}
