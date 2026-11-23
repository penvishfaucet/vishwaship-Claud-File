import { eq } from "drizzle-orm";
import { apiStaff } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { apiError } from "@/server/http";
import { getPrivate, sniffUpload } from "@/server/storage";

export const dynamic = "force-dynamic";

/** The original PDF / image of a courier bill (Finance & GST; needs the cost permission). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await apiStaff("shipments.cost.read"))) return apiError(403, "forbidden", "Not allowed");
  const db = await getDb();
  const [b] = await db.select({ key: schema.courierBills.fileKey, number: schema.courierBills.number }).from(schema.courierBills).where(eq(schema.courierBills.id, (await params).id));
  if (!b?.key) return apiError(404, "not_found", "No file attached");
  const buf = await getPrivate(b.key);
  const kind = sniffUpload(buf);
  return new Response(new Uint8Array(buf), {
    headers: { "content-type": kind?.mime ?? "application/octet-stream", "content-disposition": `inline; filename=${b.number.replace(/[^\w.-]+/g, "-")}.${kind?.ext ?? "bin"}`, "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}
