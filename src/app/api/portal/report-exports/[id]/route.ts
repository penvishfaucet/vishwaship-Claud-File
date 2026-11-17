import { and, eq } from "drizzle-orm";
import { apiCustomer } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db/client";
import { apiError } from "@/server/http";
import { XLSX_TYPE } from "@/server/xlsx";

/** Download a finished export. Only the account that created it can download it. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const { id } = await params;
  const db = await getDb();
  const [x] = await db.select().from(schema.reportExports).where(and(eq(schema.reportExports.id, id), eq(schema.reportExports.orgId, s.orgId)));
  if (!x) return apiError(404, "not_found", "Export not found");
  if (x.status !== "ready" || !x.fileB64) return apiError(409, "conflict", x.status === "failed" ? `This export failed: ${x.error}` : "This export is still being prepared");
  if (x.expiresAt && x.expiresAt < new Date()) return apiError(410, "not_found", "This export has expired. Generate it again.");
  await audit({ actorUserId: s.userId, actorKind: s.impersonatorId ? "staff" : "customer", orgId: s.orgId, action: "report.export", targetType: "report_export", targetId: id, details: { report: x.reportKey } });
  const name = `vishwaship-${x.reportKey}-${x.createdAt.toISOString().slice(0, 10)}.${x.format}`;
  return new Response(Buffer.from(x.fileB64, "base64"), { headers: { "content-type": x.format === "xlsx" ? XLSX_TYPE : "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"`, "cache-control": "private, no-store" } });
}
