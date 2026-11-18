import { and, eq } from "drizzle-orm";
import { apiCustomer } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { apiError } from "@/server/http";
import { fileResponse } from "@/server/payments/files";
import { getPrivate } from "@/server/storage";

/** The customer's own payment screenshot (tenant-scoped). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const { id } = await params;
  const db = await getDb();
  const [rc] = await db.select({ key: schema.recharges.proofKey, mime: schema.recharges.proofMime, name: schema.recharges.proofName }).from(schema.recharges)
    .where(and(eq(schema.recharges.id, id), eq(schema.recharges.orgId, s.orgId)));
  if (!rc?.key) return apiError(404, "not_found", "No screenshot");
  return fileResponse(await getPrivate(rc.key), rc.mime ?? "application/octet-stream", rc.name ?? "screenshot");
}
