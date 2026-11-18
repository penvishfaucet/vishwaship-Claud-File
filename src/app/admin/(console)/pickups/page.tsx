import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, desc, eq, inArray } from "drizzle-orm";
import { can } from "@/server/auth/rbac";
import { requireStaff } from "@/server/auth/session";
import { generatePickupRequest, nextPickupDate } from "@/server/carriers/automation";
import { getDb, schema } from "@/server/db/client";

async function generate(fd: FormData) {
  "use server";
  const s = await requireStaff("shipments.write");
  const orgId = String(fd.get("orgId")), warehouseId = String(fd.get("warehouseId"));
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(fd.get("date"))) ? String(fd.get("date")) : nextPickupDate();
  const db = await getDb();
  const ids = (await db.select({ id: schema.shipments.id }).from(schema.shipments).innerJoin(schema.orders, eq(schema.orders.id, schema.shipments.orderId))
    .where(and(eq(schema.shipments.orgId, orgId), eq(schema.orders.warehouseId, warehouseId), eq(schema.shipments.bookingStatus, "confirmed"), inArray(schema.shipments.status, ["booked", "pickup_pending"])))).map((x) => x.id);
  const r = ids.length ? await generatePickupRequest({ orgId, warehouseId, date, shipmentIds: ids, actor: { userId: s.userId, kind: "staff" } }) : [];
  revalidatePath("/admin/pickups/");
  redirect(`/admin/pickups/?msg=${encodeURIComponent(r.length ? `${r.filter((x) => x.ok).length}/${r.length} shipment(s) in a pickup request for ${date}${r.some((x) => !x.ok) ? ` — ${r.find((x) => !x.ok)!.message}` : ""}` : "Nothing to pick up")}`);
}

const STATUS: Record<string, string> = { requested: "c-active", auto: "c-draft", failed: "c-failed", cancelled: "c-draft" };

export default async function Pickups({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const sp = await searchParams;
  const st = await requireStaff("shipments.read");
  const write = can(st.role, "shipments.write");
  const db = await getDb();
  const rows = await db.select({ s: schema.shipments, o: schema.orgs, w: schema.warehouses, ord: schema.orders }).from(schema.shipments)
    .innerJoin(schema.orgs, eq(schema.orgs.id, schema.shipments.orgId)).innerJoin(schema.orders, eq(schema.orders.id, schema.shipments.orderId)).leftJoin(schema.warehouses, eq(schema.warehouses.id, schema.orders.warehouseId))
    .where(and(eq(schema.shipments.bookingStatus, "confirmed"), inArray(schema.shipments.status, ["booked", "pickup_pending"]))).orderBy(desc(schema.shipments.createdAt)).limit(500);
  const groups = new Map<string, typeof rows>();
  for (const r of rows) { const k = `${r.o.id}|${r.w?.id ?? ""}`; groups.set(k, [...(groups.get(k) ?? []), r]); }
  const prs = await db.select({ p: schema.pickupRequests, o: schema.orgs, w: schema.warehouses, a: schema.providerAccounts }).from(schema.pickupRequests)
    .innerJoin(schema.orgs, eq(schema.orgs.id, schema.pickupRequests.orgId)).innerJoin(schema.warehouses, eq(schema.warehouses.id, schema.pickupRequests.warehouseId)).leftJoin(schema.providerAccounts, eq(schema.providerAccounts.id, schema.pickupRequests.providerAccountId))
    .orderBy(desc(schema.pickupRequests.createdAt)).limit(200);
  const tomorrow = nextPickupDate();
  return (
    <>
      <div className="page-h"><div><h1>Pickups</h1><p className="small muted" style={{ margin: "4px 0 0" }}>Pending pickups by customer and pickup address, and every courier pickup request (PR) with its pickup agent.</p></div></div>
      {sp.msg && <p className="note small" role="status">{sp.msg}</p>}
      <section className="card p0">
        <h2 className="b small card-h" style={{ margin: 0 }}>Waiting for pickup</h2>
        {groups.size === 0 ? <p className="small muted" style={{ padding: 16 }}>No pickups pending.</p> : (
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>Customer</th><th>Pickup address</th><th>Shipments</th><th>Couriers</th><th>Pickup request</th><th /></tr></thead>
            <tbody>{[...groups.values()].map((g) => {
              const { o, w } = g[0];
              const done = g.filter((x) => x.s.pickupStatus === "scheduled").length;
              return (
                <tr key={`${o.id}-${w?.id}`}>
                  <td className="small"><Link className="link-navy" href={`/admin/customers/${o.id}/`}>{o.businessName}</Link></td>
                  <td className="small">{w?.label}<br /><span className="tiny muted">{w?.city} {w?.pincode}</span></td>
                  <td className="small">{g.length}<div className="mono tiny muted">{g.slice(0, 4).map((x) => x.s.lrNumber ?? x.s.awb).join(", ")}{g.length > 4 ? " …" : ""}</div></td>
                  <td className="small">{[...new Set(g.map((x) => `${x.s.carrierName} (${x.s.provider})`))].join(", ")}</td>
                  <td className="small">{done}/{g.length} requested{g.find((x) => x.s.pickupRef)?.s.pickupRef ? <div className="mono tiny">PR {g.find((x) => x.s.pickupRef)!.s.pickupRef}</div> : null}</td>
                  <td>{write && w && <form action={generate} className="row" style={{ gap: 6 }}><input type="hidden" name="orgId" value={o.id} /><input type="hidden" name="warehouseId" value={w.id} /><label className="sr-only" htmlFor={`d-${o.id}-${w.id}`}>Pickup date</label><input id={`d-${o.id}-${w.id}`} type="date" name="date" className="input" defaultValue={tomorrow} style={{ maxWidth: 150 }} /><button className="btn btn-sm btn-orange">Generate PR</button></form>}</td>
                </tr>
              );
            })}</tbody></table></div>
        )}
      </section>
      <section className="card p0 mt16">
        <h2 className="b small card-h" style={{ margin: 0 }}>Pickup requests</h2>
        {prs.length === 0 ? <p className="small muted" style={{ padding: 16 }}>None yet.</p> : (
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>PR ID</th><th>Date</th><th>Customer</th><th>Pickup address</th><th>Courier account</th><th>Shipments</th><th>Pickup agent</th><th>Status</th></tr></thead>
            <tbody>{prs.map(({ p, o, w, a }) => (
              <tr key={p.id}><td className="mono small b">{p.providerRef ?? "—"}</td><td className="small">{p.pickupDate}</td><td className="small">{o.businessName}</td><td className="small">{w.label} · {w.pincode}</td><td className="small">{a?.label ?? p.providerAccountId}</td>
                <td className="small">{(p.shipmentIds as string[]).length} · {p.packageCount} box(es)</td>
                <td className="small">{p.agentName ?? "—"}{p.agentPhone && <> · <a className="link-navy" href={`tel:+91${p.agentPhone}`}>{p.agentPhone}</a></>}</td>
                <td><span className={`chip ${STATUS[p.status] ?? "c-draft"}`}>{p.status}</span>{p.lastError ? <div className="tiny t-debit">{p.lastError}</div> : null}</td></tr>
            ))}</tbody></table></div>
        )}
      </section>
    </>
  );
}
