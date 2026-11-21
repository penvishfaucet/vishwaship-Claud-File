import "server-only";
import { getDb, schema } from "@/server/db/client";
import { newId } from "@/server/util/ids";

export async function audit(e: {
  actorUserId?: string | null; actorKind: "staff" | "customer" | "system" | "api_key" | "franchise"; orgId?: string | null;
  action: string; targetType?: string; targetId?: string; details?: Record<string, unknown>;
}) {
  const db = await getDb();
  await db.insert(schema.auditLog).values({ id: newId("aud"), ...e, details: e.details ?? null });
}
