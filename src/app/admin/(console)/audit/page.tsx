import Link from "next/link";
import { desc, ilike } from "drizzle-orm";
import { requireStaff } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const sp = await searchParams;
  await requireStaff("audit.read");
  const page = Math.max(1, Number(sp.page ?? 1));
  const db = await getDb();
  const rows = await db.select().from(schema.auditLog).where(sp.q ? ilike(schema.auditLog.action, `%${sp.q.replace(/[%_]/g, "")}%`) : undefined).orderBy(desc(schema.auditLog.createdAt)).limit(100).offset((page - 1) * 100);
  return (
    <>
      <div className="page-h"><h1>Audit Log</h1></div>
      <form className="row mb12" style={{ gap: 8 }} role="search"><label htmlFor="aq2" className="sr-only">Action</label><input id="aq2" name="q" className="input" defaultValue={sp.q} placeholder="Filter by action, e.g. pricing" style={{ maxWidth: 280 }} /><button className="btn btn-navy">Filter</button></form>
      <div className="card p0 tbl-wrap"><table className="tbl"><thead><tr><th>Time (IST)</th><th>Actor</th><th>Action</th><th>Customer</th><th>Target</th><th>Details</th></tr></thead>
        <tbody>{rows.map((a) => <tr key={a.id}><td className="small">{a.createdAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</td><td className="small">{a.actorKind}<div className="tiny mono muted">{a.actorUserId ?? ""}</div></td><td className="small b">{a.action}</td><td className="mono tiny">{a.orgId ?? "—"}</td><td className="mono tiny">{a.targetType ? `${a.targetType}:${a.targetId}` : "—"}</td><td className="mono tiny" style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis" }}>{a.details ? JSON.stringify(a.details) : ""}</td></tr>)}</tbody></table></div>
      <nav className="row mt12" style={{ gap: 8 }}>{page > 1 && <Link className="btn btn-sm btn-outline" href={`/admin/audit/?page=${page - 1}&q=${sp.q ?? ""}`}>Previous</Link>}{rows.length === 100 && <Link className="btn btn-sm btn-outline" href={`/admin/audit/?page=${page + 1}&q=${sp.q ?? ""}`}>Next</Link>}</nav>
    </>
  );
}
