import { and, desc, eq, inArray } from "drizzle-orm";
import { Phone } from "lucide-react";
import { PickupRequestForm } from "@/components/portal/PickupRequestForm";
import { partnerCodeFor } from "@/server/carriers/specs";
import { pickupEligible } from "@/server/carriers/automation";
import { getDb, schema } from "@/server/db/client";
import { portalContext } from "@/server/portal/context";
import { adapterFor } from "@/server/providers/registry";

const STATUS: Record<string, [string, string]> = { requested: ["Requested", "c-active"], auto: ["Automatic", "c-draft"], failed: ["Failed", "c-failed"], cancelled: ["Cancelled", "c-draft"] };

/** Customer → Pickups: generate courier pickup requests (PR) and see each PR with its pickup agent. */
export default async function PickupsPage() {
  const ctx = await portalContext();
  const db = await getDb();
  const warehouses = await db.select().from(schema.warehouses).where(and(eq(schema.warehouses.orgId, ctx.org.id), eq(schema.warehouses.active, true)));
  const eligible = await pickupEligible(ctx.org.id);
  const accts = eligible.length ? await db.select().from(schema.providerAccounts).where(inArray(schema.providerAccounts.id, [...new Set(eligible.map((r) => r.s.providerAccountId))])) : [];
  const pk = eligible.length ? await db.select().from(schema.packages).where(inArray(schema.packages.orderId, eligible.map((r) => r.o.id))) : [];
  const rows = eligible.map(({ s, o }) => {
    const a = accts.find((x) => x.id === s.providerAccountId);
    return {
      id: s.id, warehouseId: o.warehouseId ?? "", orderNumber: o.orderNumber, awb: s.lrNumber ?? s.awb, carrier: s.carrierName,
      code: a ? partnerCodeFor(a.adapter, a.configPublic as Record<string, unknown>) : null, boxes: pk.filter((p) => p.orderId === o.id).reduce((t, p) => t + p.count, 0) || 1,
      pickup: s.pickupStatus, auto: !(a && adapterFor(a)?.implemented.includes("pickup")),
    };
  });
  const prs = await db.select({ p: schema.pickupRequests, w: schema.warehouses }).from(schema.pickupRequests).innerJoin(schema.warehouses, eq(schema.warehouses.id, schema.pickupRequests.warehouseId))
    .where(eq(schema.pickupRequests.orgId, ctx.org.id)).orderBy(desc(schema.pickupRequests.createdAt)).limit(100);
  const prShip = prs.length ? await db.select({ id: schema.shipments.id, carrier: schema.shipments.carrierName, awb: schema.shipments.awb, lr: schema.shipments.lrNumber }).from(schema.shipments).where(inArray(schema.shipments.id, prs.flatMap(({ p }) => p.shipmentIds as string[]).slice(0, 2000))) : [];
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

  return (
    <>
      <div className="page-h"><div><h1>Pickups</h1><p className="small muted" style={{ margin: "4px 0 0" }}>Raise a courier pickup request for your booked shipments and see who is coming to collect them.</p></div></div>
      <PickupRequestForm warehouses={warehouses.map((w) => ({ id: w.id, label: w.label, pincode: w.pincode }))} rows={rows} today={today} />
      <section className="card p0 mt16">
        <h2 className="b small card-h" style={{ margin: 0 }}>Pickup requests</h2>
        {prs.length === 0 ? <p className="small muted" style={{ padding: 16 }}>No pickup requests yet. Requests are also raised automatically right after booking.</p> : (
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>PR ID</th><th>Pickup date</th><th>Pickup address</th><th>Courier</th><th>Shipments</th><th>Pickup agent</th><th>Status</th></tr></thead>
            <tbody>{prs.map(({ p, w }) => {
              const ships = prShip.filter((x) => (p.shipmentIds as string[]).includes(x.id));
              const [label, chip] = STATUS[p.status] ?? [p.status, "c-draft"];
              return (
                <tr key={p.id}>
                  <td className="mono small b">{p.providerRef ?? <span className="muted">awaiting ID</span>}</td>
                  <td className="small">{new Date(`${p.pickupDate}T00:00:00+05:30`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}</td>
                  <td className="small">{w.label}<br /><span className="tiny muted">{w.city} {w.pincode}</span></td>
                  <td className="small">{[...new Set(ships.map((x) => x.carrier))].join(", ") || "—"}</td>
                  <td className="small">{ships.length} · {p.packageCount} box(es)<div className="mono tiny muted">{ships.slice(0, 3).map((x) => x.lr ?? x.awb).filter(Boolean).join(", ")}{ships.length > 3 ? " …" : ""}</div></td>
                  <td className="small">{p.agentName || p.agentPhone ? <>{p.agentName ?? "Pickup agent"}{p.agentPhone && <div><a className="btn btn-sm btn-outline mt8" href={`tel:+91${p.agentPhone}`}><Phone size={14} aria-hidden /> Call {p.agentPhone}</a></div>}</> : <span className="tiny muted">Shared by the courier when assigned</span>}</td>
                  <td><span className={`chip ${chip}`}>{label}</span></td>
                </tr>
              );
            })}</tbody></table></div>
        )}
      </section>
    </>
  );
}
