import { redirect } from "next/navigation";
import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/server/db/client";
import { audit } from "@/server/audit";
import { portalContext } from "@/server/portal/context";
import { newId } from "@/server/util/ids";

const CATS = ["pickup_issue", "delivery_delay", "ndr_rto", "weight_dispute", "damaged_lost", "billing", "cod_remittance", "kyc", "other"] as const;

async function createTicket(fd: FormData) {
  "use server";
  const ctx = await portalContext();
  const v = z.object({ category: z.enum(CATS), subject: z.string().trim().min(4).max(120), body: z.string().trim().min(10).max(4000), awb: z.string().trim().max(40).optional() }).parse(Object.fromEntries(fd));
  const db = await getDb();
  let shipmentId: string | null = null;
  if (v.awb) {
    const [s] = await db.select({ id: schema.shipments.id }).from(schema.shipments).where(and(eq(schema.shipments.orgId, ctx.org.id), eq(schema.shipments.awb, v.awb.toUpperCase())));
    shipmentId = s?.id ?? null;
  }
  const [{ n }] = await db.select({ n: count() }).from(schema.tickets);
  const id = newId("tkt");
  await db.insert(schema.tickets).values({ id, orgId: ctx.org.id, number: `VT${String(10001 + Number(n))}`, category: v.category, subject: v.subject, shipmentId, awb: v.awb?.toUpperCase() || null });
  await db.insert(schema.ticketMessages).values({ id: newId("tm"), ticketId: id, authorUserId: ctx.session.userId, authorKind: "customer", body: v.body });
  await audit({ actorUserId: ctx.session.userId, actorKind: "customer", orgId: ctx.org.id, action: "ticket.create", targetType: "ticket", targetId: id });
  redirect(`/portal/support/${id}/`);
}

export default async function NewTicket({ searchParams }: { searchParams: Promise<{ awb?: string; category?: string; order?: string }> }) {
  const sp = await searchParams;
  return (
    <>
      <div className="page-h"><h1>Raise Ticket</h1></div>
      <form action={createTicket} className="card col" style={{ padding: 18, gap: 12, maxWidth: 680 }}>
        <div className="grid2" style={{ gap: 12 }}>
          <div className="field"><label htmlFor="cat">Category</label><select id="cat" name="category" className="select" defaultValue={sp.category ?? "other"}>{CATS.map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}</select></div>
          <div className="field"><label htmlFor="awb">AWB / LR (optional)</label><input id="awb" name="awb" className="input" defaultValue={sp.awb ?? ""} /></div>
        </div>
        <div className="field"><label htmlFor="sub">Subject</label><input id="sub" name="subject" className="input" required minLength={4} defaultValue={sp.order ? `Order ${sp.order}` : ""} /></div>
        <div className="field"><label htmlFor="body">Describe the issue</label><textarea id="body" name="body" className="textarea" rows={6} required minLength={10} /></div>
        <p className="tiny muted">You can add photos and documents in the ticket conversation after it is created.</p>
        <button className="btn btn-orange" style={{ alignSelf: "start" }}>Submit ticket</button>
      </form>
    </>
  );
}
