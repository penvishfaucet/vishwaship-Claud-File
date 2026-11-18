import { eq } from "drizzle-orm";
import { apiStaff } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { apiError } from "@/server/http";
import { fileResponse } from "@/server/payments/files";
import { getPrivate } from "@/server/storage";

/** Payment screenshot for Admin review (finance.read). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiStaff("finance.read");
  if (!s) return apiError(403, "forbidden", "Not allowed");
  const { id } = await params;
  const db = await getDb();
  const [rc] = await db.select({ key: schema.recharges.proofKey, mime: schema.recharges.proofMime, name: schema.recharges.proofName }).from(schema.recharges).where(eq(schema.recharges.id, id));
  if (!rc?.key) return apiError(404, "not_found", "No screenshot");
  return fileResponse(await getPrivate(rc.key), rc.mime ?? "application/octet-stream", rc.name ?? "screenshot");
}
