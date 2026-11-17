import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { Ticket } from "lucide-react";
import { getDb, schema } from "@/server/db/client";
import { portalContext } from "@/server/portal/context";

export default async function SupportPage() {
  const ctx = await portalContext();
  const db = await getDb();
  const rows = await db.select().from(schema.tickets).where(eq(schema.tickets.orgId, ctx.org.id)).orderBy(desc(schema.tickets.createdAt));
  return (
    <>
      <div className="page-h"><h1>Support</h1><div className="actions"><Link className="btn btn-orange" href="/portal/support/new/"><Ticket size={16} /> Raise Ticket</Link></div></div>
      {rows.length === 0 ? <div className="card empty"><p className="muted">No tickets yet. Need help with a shipment? Raise a ticket and attach the AWB.</p></div> : (
        <div className="card p0 tbl-wrap"><table className="tbl"><thead><tr><th>Ticket</th><th>Subject</th><th>Category</th><th>AWB</th><th>Status</th><th>Opened</th></tr></thead>
          <tbody>{rows.map((t) => <tr key={t.id}><td><Link className="link-navy b" href={`/portal/support/${t.id}/`}>{t.number}</Link></td><td>{t.subject}</td><td className="small">{t.category.replace(/_/g, " ")}</td><td className="mono tiny">{t.awb ?? "—"}</td><td><span className={`chip c-${t.status}`}>{t.status.replace("_", " ")}</span></td><td className="small">{t.createdAt.toLocaleDateString("en-IN")}</td></tr>)}</tbody></table></div>
      )}
    </>
  );
}
