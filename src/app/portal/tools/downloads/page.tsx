import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { Download } from "lucide-react";
import { AutoRefresh } from "@/components/portal/AutoRefresh";
import { getDb, schema } from "@/server/db/client";
import { requireFeature } from "@/server/features";
import { portalContext } from "@/server/portal/context";
import { REPORTS } from "@/server/reports";

const CHIP: Record<string, string> = { queued: "c-pending", running: "c-pending", ready: "c-active", failed: "c-failed" };
const LABEL: Record<string, string> = { queued: "Queued", running: "Preparing…", ready: "Ready", failed: "Failed" };
const FILTER_LABEL: Record<string, string> = { from: "From", to: "To", status: "Status", payment: "Payment", mode: "Type", carrier: "Courier", q: "Search", columns: "Columns", tag: "Tag" };

export default async function DownloadsPage() {
  const ctx = await portalContext();
  await requireFeature(ctx.org.id, "reports");
  const db = await getDb();
  const rows = await db.select({ id: schema.reportExports.id, reportKey: schema.reportExports.reportKey, filters: schema.reportExports.filters, format: schema.reportExports.format, status: schema.reportExports.status, rowCount: schema.reportExports.rowCount, error: schema.reportExports.error, createdAt: schema.reportExports.createdAt, finishedAt: schema.reportExports.finishedAt, expiresAt: schema.reportExports.expiresAt })
    .from(schema.reportExports).where(eq(schema.reportExports.orgId, ctx.org.id)).orderBy(desc(schema.reportExports.createdAt)).limit(100);
  const pending = rows.some((r) => r.status === "queued" || r.status === "running");
  const now = new Date();
  return (
    <>
      <AutoRefresh active={pending} />
      <div className="page-h">
        <div><h1>Report Download</h1><p className="small muted" style={{ margin: "4px 0 0" }}>Exports prepared in the background. Files are kept for 7 days and contain only your account’s data.</p></div>
        <div className="actions"><Link className="btn btn-orange" href="/portal/reports/shipments/">New report</Link></div>
      </div>
      {rows.length === 0 ? <div className="card empty"><p className="muted">No exports yet. Open any report, set filters and choose “Generate in background”.</p></div> : (
        <div className="card p0 tbl-wrap"><table className="tbl">
          <thead><tr><th>Requested</th><th>Report</th><th>Filters</th><th>Format</th><th>Status</th><th>Rows</th><th /></tr></thead>
          <tbody>{rows.map((r) => {
            const f = Object.entries(r.filters as Record<string, string>).filter(([, v]) => v);
            const expired = r.expiresAt && r.expiresAt < now;
            return (
              <tr key={r.id}>
                <td className="small">{r.createdAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })}</td>
                <td className="small b">{REPORTS[r.reportKey as keyof typeof REPORTS]?.title ?? r.reportKey}</td>
                <td className="tiny">{f.length ? f.map(([k, v]) => `${FILTER_LABEL[k] ?? k}: ${v}`).join(" · ") : <span className="muted">Last 30 days, all</span>}</td>
                <td className="small">{r.format.toUpperCase()}</td>
                <td><span className={`chip ${expired ? "c-draft" : CHIP[r.status]}`}>{expired ? "Expired" : LABEL[r.status]}</span>{r.status === "failed" && r.error && <div className="tiny t-debit">{r.error}</div>}</td>
                <td className="small">{r.rowCount ?? "—"}</td>
                <td>{r.status === "ready" && !expired ? <a className="btn btn-sm btn-navy" href={`/api/portal/report-exports/${r.id}/`}><Download size={14} /> Download</a> : null}</td>
              </tr>
            );
          })}</tbody>
        </table></div>
      )}
    </>
  );
}
