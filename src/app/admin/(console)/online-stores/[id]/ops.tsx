import { and, eq, gte, sql } from "drizzle-orm";
import { planState } from "@/lib/store-plan";
import { getDb, schema } from "@/server/db/client";
import { RTO_STATE_LABEL, rtoReport } from "@/server/rto/charges";
import { codShipments, codTotals } from "@/server/store/cod";
import { STAGE_LABEL, tabCounts } from "@/server/store/orders";
import { istDate, storePnl } from "@/server/store/pnl";

const rs = (p: number) => `${p < 0 ? "−" : ""}₹${Math.abs(p / 100).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const day = (d: Date | null) => (d ? d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" }) : "—");

/**
 * Admin → one store → operations at a glance: plan and its payments, orders by stage, courier charges, RTO charges,
 * COD reconciliation and the merchant's own P&L for the last 30 days (the same figures the merchant sees).
 */
export async function StoreOps({ store }: { store: typeof schema.stores.$inferSelect }) {
  const db = await getDb();
  const since = new Date(Date.now() - 30 * 86_400_000);
  const plan = planState(store);
  const [counts, ship, rto, cod, pnl, pays] = await Promise.all([
    tabCounts(store.orgId),
    db.select({ n: sql<number>`count(*)::int`, amt: sql<number>`coalesce(sum(${schema.shipments.sellPaise}), 0)::bigint` }).from(schema.shipments)
      .innerJoin(schema.orders, eq(schema.orders.id, schema.shipments.orderId))
      .where(and(eq(schema.shipments.orgId, store.orgId), eq(schema.orders.source, "online_store"), eq(schema.shipments.bookingStatus, "confirmed"), gte(schema.shipments.createdAt, since))),
    rtoReport(store.orgId, { storeOnly: true }),
    codShipments(store.orgId, { storeOnly: true }),
    storePnl(store.orgId, { from: istDate(since), to: istDate(new Date()) }),
    db.select().from(schema.ledgerEntries).innerJoin(schema.wallets, eq(schema.wallets.id, schema.ledgerEntries.walletId))
      .where(and(eq(schema.wallets.orgId, store.orgId), eq(schema.ledgerEntries.kind, "store_plan"))).orderBy(sql`${schema.ledgerEntries.createdAt} desc`).limit(6),
  ]);
  const t = codTotals(cod);
  const rtoBy = Object.entries(RTO_STATE_LABEL).map(([k, l]) => [l, rto.filter((r) => r.state === k).length] as const).filter(([, n]) => n > 0);
  return (
    <div className="card" style={{ padding: 16, marginBottom: 16 }}>
      <h3 style={{ fontSize: 14, marginBottom: 8 }}>Operations</h3>
      <div className="grid2" style={{ alignItems: "start", gap: 16 }}>
        <dl className="kv-list">
          <dt>Plan</dt><dd><span className={`chip ${plan.state === "expired" ? "c-failed" : "c-active"}`}>{plan.state === "expired" ? "Expired: store unavailable to buyers" : plan.state === "trial" ? "Free trial" : "Active"}</span>{plan.until ? ` · ${plan.state === "expired" ? "ended" : "until"} ${day(plan.until)}` : ""}</dd>
          <dt>Plan payments</dt><dd>{pays.length ? pays.map((p) => <div key={p.ledger_entries.id} className="small">{day(p.ledger_entries.createdAt)} · {rs(-p.ledger_entries.amountPaise)} · <span className="mono tiny">{p.ledger_entries.id}</span></div>) : "None"}</dd>
          <dt>Orders</dt><dd>{(["pending", "to_pack", "ready", "transit", "delivered", "rto", "cancelled"] as const).map((k) => `${({ pending: STAGE_LABEL.pending_acceptance, to_pack: STAGE_LABEL.to_pack, ready: STAGE_LABEL.ready_to_ship, transit: "In transit", delivered: "Delivered", rto: "RTO", cancelled: "Rejected / cancelled" })[k]} ${counts[k] ?? 0}`).join(" · ")}</dd>
          <dt>Courier charges (30 days)</dt><dd>{ship[0].n} shipments · {rs(Number(ship[0].amt))}</dd>
        </dl>
        <dl className="kv-list">
          <dt>RTO charges</dt><dd>{rto.length} RTO · final {rs(rto.filter((r) => !r.estimated).reduce((s, r) => s + (r.finalChargePaise ?? 0), 0))} · estimated {rs(rto.filter((r) => r.estimated).reduce((s, r) => s + r.rtoChargePaise, 0))}{rtoBy.length ? <div className="tiny muted">{rtoBy.map(([l, n]) => `${l} ${n}`).join(" · ")}</div> : null}
            <div><a className="small orange" href="/admin/online-stores/?tab=rto">Open RTO &amp; COD</a></div></dd>
          <dt>COD</dt><dd>collected {rs(t.collected)} · paid out {rs(t.remitted)} · outstanding {rs(t.outstanding)}{t.byState.disputed ? <span className="red"> · {t.byState.disputed} question(s)</span> : null}</dd>
          <dt>Merchant P&amp;L (30 days)</dt><dd>revenue {rs(pnl.summary.revenue)} · net {rs(pnl.summary.net)}{pnl.summary.incomplete ? <span className="tiny red"> · {pnl.summary.incomplete} order(s) without cost</span> : null}</dd>
        </dl>
      </div>
    </div>
  );
}
