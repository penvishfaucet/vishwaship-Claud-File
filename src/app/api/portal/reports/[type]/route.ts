import { apiCustomer } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { hasFeature } from "@/server/features";
import { apiError } from "@/server/http";
import { REPORTS, type ReportKey, parseFilters, runReport } from "@/server/reports";
import { XLSX_TYPE, toXlsx } from "@/server/xlsx";
import { toCsv } from "@/lib/csv";

/** Download = exactly the on-screen report (same filters), only the signed-in customer's records. */
export async function GET(req: Request, { params }: { params: Promise<{ type: string }> }) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  if (!(await hasFeature(s.orgId, "reports"))) return apiError(403, "forbidden", "Reports are not enabled for your account");
  const { type } = await params;
  if (!(type in REPORTS)) return apiError(404, "not_found", "Unknown report");
  const u = new URL(req.url);
  const r = await runReport(s.orgId, type as ReportKey, parseFilters(u.searchParams), 50_000);
  const headers = r.columns.map((c) => c.label);
  await audit({ actorUserId: s.userId, actorKind: s.impersonatorId ? "staff" : "customer", orgId: s.orgId, action: "report.export", details: { type, rows: r.total, filters: Object.fromEntries(u.searchParams) } });
  const name = `vishwaship-${type}-${new Date().toISOString().slice(0, 10)}`;
  if (u.searchParams.get("format") === "xlsx") {
    return new Response(await toXlsx(REPORTS[type as ReportKey].title, headers, r.rows), { headers: { "content-type": XLSX_TYPE, "content-disposition": `attachment; filename="${name}.xlsx"`, "cache-control": "private, no-store" } });
  }
  return new Response(toCsv(headers, r.rows), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}.csv"`, "cache-control": "private, no-store" } });
}
