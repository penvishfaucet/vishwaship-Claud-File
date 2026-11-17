import { NextResponse } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { apiCustomer } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db/client";
import { hasFeature } from "@/server/features";
import { apiError, parseJson } from "@/server/http";
import { enqueue } from "@/server/jobs/runner";
import { REPORTS } from "@/server/reports";
import { newId } from "@/server/util/ids";

const Body = z.object({
  reportKey: z.string().refine((k) => k in REPORTS, "Unknown report"),
  format: z.enum(["csv", "xlsx"]),
  filters: z.record(z.string().max(40), z.string().max(400)).default({}),
});

/** Queue a background export; the file appears in Tools → Report Download. */
export async function POST(req: Request) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  if (!(await hasFeature(s.orgId, "reports"))) return apiError(403, "forbidden", "Reports are not enabled for your account");
  const p = await parseJson(req, Body);
  if (!p.ok) return p.res;
  const db = await getDb();
  const [busy] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.reportExports).where(and(eq(schema.reportExports.orgId, s.orgId), inArray(schema.reportExports.status, ["queued", "running"])));
  if ((busy?.n ?? 0) >= 3) return apiError(429, "rate_limited", "3 exports are already being prepared. Wait for one to finish.");
  const id = newId("rx");
  const filters = Object.fromEntries(Object.entries(p.data.filters).filter(([k]) => !["page", "format"].includes(k)));
  await db.insert(schema.reportExports).values({ id, orgId: s.orgId, userId: s.userId, reportKey: p.data.reportKey, filters, format: p.data.format, status: "queued" });
  await enqueue("report.export", { exportId: id }, { dedupeKey: `report.export:${id}` });
  await audit({ actorUserId: s.userId, actorKind: s.impersonatorId ? "staff" : "customer", orgId: s.orgId, action: "report.queued", targetType: "report_export", targetId: id, details: { report: p.data.reportKey, filters } });
  return NextResponse.json({ id, status: "queued" }, { status: 202 });
}
