import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, schema } from "@/server/db/client";
import { portalContext } from "@/server/portal/context";

export default async function AlertsPage() {
  const ctx = await portalContext();
  const db = await getDb();
  const rows = await db.select().from(schema.inAppAlerts).where(eq(schema.inAppAlerts.orgId, ctx.org.id)).orderBy(desc(schema.inAppAlerts.createdAt)).limit(100);
  async function markAll() {
    "use server";
    const c = await portalContext();
    const d = await getDb();
    await d.update(schema.inAppAlerts).set({ readAt: new Date() }).where(eq(schema.inAppAlerts.orgId, c.org.id));
    revalidatePath("/portal", "layout");
  }
  return (
    <>
      <div className="page-h"><h1>Alerts</h1><form action={markAll}><button className="btn btn-outline">Mark all read</button></form></div>
      {rows.length === 0 ? <div className="card empty"><p className="muted">No alerts.</p></div> : (
        <ul className="card p0 plain-list">
          {rows.map((a) => <li key={a.id} className="row between"><Link href={a.href ?? "#"} className={a.readAt ? "small" : "small b"}>{a.title}</Link><span className="tiny muted">{a.createdAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}</span></li>)}
        </ul>
      )}
    </>
  );
}
