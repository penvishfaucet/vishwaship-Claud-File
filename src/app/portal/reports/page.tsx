import Link from "next/link";
import { FileDown } from "lucide-react";
import { t } from "@/server/content";
import { requireFeature } from "@/server/features";
import { portalContext } from "@/server/portal/context";
import { REPORTS } from "@/server/reports";

export default async function ReportsHome() {
  const ctx = await portalContext();
  await requireFeature(ctx.org.id, "reports");
  return (
    <>
      <div className="page-h"><div><h1>Reports</h1><p className="small muted" style={{ margin: "4px 0 0" }}>{await t("portal.reports.help")}</p></div></div>
      <div className="grid3" style={{ gap: 12 }}>
        {Object.entries(REPORTS).map(([k, r]) => (
          <Link key={k} href={`/portal/reports/${k}/`} className="card stat-link" style={{ padding: 16, display: "block" }}>
            <div className="row" style={{ gap: 8, alignItems: "center" }}><FileDown size={18} color="var(--orange)" /><b>{r.title}</b></div>
            <p className="small muted" style={{ margin: "6px 0 0" }}>{r.desc}</p>
          </Link>
        ))}
      </div>
    </>
  );
}
