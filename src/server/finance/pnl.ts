import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { getSetting } from "@/server/quotes/service";
import { ownAccountIds } from "@/server/finance/own-accounts";

/**
 * Profit & loss per customer and overall (Admin only — figures include Vishwaship's courier cost).
 *
 * Revenue (pre-GST):
 *   - shipping: what the customer paid for each booked, not-cancelled shipment (sell incl. GST ÷ (1 + GST))
 *   - weight discrepancy: weight charges taken from the wallet minus weight refunds (÷ (1 + GST))
 *   - notification credits sold (stored pre-GST at purchase)
 *   - manual wallet adjustments (debits − credits, as booked by staff)
 * Cost:
 *   - courier: the carrier-confirmed charge where the courier reported one, else the quoted cost (pre-GST)
 * Profit = revenue − cost. Cancelled shipments are left out (their charge was refunded).
 * Money flow (not P&L): recharged, wallet balance, consumed, GST collected (payable).
 * FOD freight the courier collects from receivers is shown separately (it does not pass through the wallet).
 */
export type PnlRow = {
  orgId: string; name: string;
  shipments: number; shippingGross: number; shippingRevenue: number; courierCost: number; quotedCost: number; carrierExtra: number;
  weightNet: number; weightRevenue: number; creditsRevenue: number; adjustmentsNet: number;
  revenue: number; profit: number; marginPct: number | null; gstCollected: number;
  recharged: number; walletBalance: number; consumed: number; fodFreight: number; openDisputes: number; lossShipments: number;
};
export type PnlRange = { from: Date; to: Date } | null;

type Q = Record<string, string | number | null>;
const rowsOf = (r: unknown) => (((r as { rows?: Q[] }).rows ?? (r as Q[])) as Q[]);
const n = (v: unknown) => Number(v ?? 0) || 0;

export async function pnlByOrg(range: PnlRange, orgId?: string): Promise<{ rows: PnlRow[]; own: PnlRow[]; total: PnlRow; gstBps: number }> {
  const db = await getDb();
  const gstBps = Number((await getSetting<number>("gst_bps", 1800)).value) || 1800;
  const pre = (paise: number) => Math.round((paise * 10_000) / (10_000 + gstBps));
  const sw = (col: ReturnType<typeof sql>) => range ? sql`and ${col} >= ${range.from} and ${col} <= ${range.to}` : sql``;
  const org = (col: ReturnType<typeof sql>) => orgId ? sql`and ${col} = ${orgId}` : sql``;

  const [orgs, ships, ledger, credits, disputes, wallets] = await Promise.all([
    db.execute(sql`select id, coalesce(nullif(business_name, ''), name) as name from orgs where true ${org(sql`id`)}`),
    db.execute(sql`
      select s.org_id,
        count(*)::int as shipments,
        coalesce(sum(s.sell_paise), 0)::bigint as sell,
        coalesce(sum(coalesce(s.carrier_charge_paise, s.cost_paise)), 0)::bigint as cost,
        coalesce(sum(s.cost_paise), 0)::bigint as quoted,
        coalesce(sum(greatest(coalesce(s.carrier_charge_paise, s.cost_paise) - s.cost_paise, 0)), 0)::bigint as extra,
        coalesce(sum(case when s.freight_payer = 'receiver' then s.receiver_freight_paise else 0 end), 0)::bigint as fod,
        count(*) filter (where (s.sell_paise + case when s.freight_payer = 'receiver' then s.receiver_freight_paise else 0 end) * 10000 / (10000 + ${gstBps}) < coalesce(s.carrier_charge_paise, s.cost_paise))::int as loss
      from shipments s
      where s.booking_status = 'confirmed' and s.status <> 'cancelled' ${sw(sql`s.created_at`)} ${org(sql`s.org_id`)}
      group by s.org_id`),
    db.execute(sql`
      select w.org_id, l.kind, coalesce(sum(l.amount_paise), 0)::bigint as amt
      from ledger_entries l join wallets w on w.id = l.wallet_id
      where l.kind in ('recharge_credit', 'weight_charge', 'weight_reversal', 'rto_charge', 'rto_credit', 'adjustment_credit', 'adjustment_debit', 'reserve_settle', 'credits_purchase', 'refund_credit', 'refund_debit', 'store_plan', 'store_fee')
        ${sw(sql`l.created_at`)} ${org(sql`w.org_id`)}
      group by w.org_id, l.kind`),
    db.execute(sql`select org_id, coalesce(sum(price_paise), 0)::bigint as price from credit_entries where kind = 'purchase' ${sw(sql`created_at`)} ${org(sql`org_id`)} group by org_id`),
    db.execute(sql`select org_id, count(*)::int as open from weight_disputes where status in ('open', 'disputed') ${org(sql`org_id`)} group by org_id`),
    db.execute(sql`select org_id, (posted_paise - reserved_paise)::bigint as bal from wallets where true ${org(sql`org_id`)}`),
  ]);

  const by = <T,>(r: unknown, f: (x: Q) => T) => new Map(rowsOf(r).map((x) => [String(x.org_id), f(x)]));
  const S = by(ships, (x) => x), C = by(credits, (x) => n(x.price)), D = by(disputes, (x) => n(x.open)), W = by(wallets, (x) => n(x.bal));
  const L = new Map<string, Record<string, number>>();
  for (const x of rowsOf(ledger)) { const k = String(x.org_id); const m = L.get(k) ?? {}; m[String(x.kind)] = n(x.amt); L.set(k, m); }

  const rows: PnlRow[] = rowsOf(orgs).map((o) => {
    const id = String(o.id), s = S.get(id), l = L.get(id) ?? {};
    const shippingGross = n(s?.sell), shippingRevenue = pre(shippingGross), courierCost = n(s?.cost);
    // weight + RTO charges taken from the wallet after booking (charges are negative, reversals positive)
    const weightNet = -(l.weight_charge ?? 0) - (l.weight_reversal ?? 0) - (l.rto_charge ?? 0) - (l.rto_credit ?? 0);
    const weightRevenue = pre(Math.max(weightNet, 0)) + Math.min(weightNet, 0);
    const creditsRevenue = C.get(id) ?? 0;
    const adjustmentsNet = -(l.adjustment_debit ?? 0) - (l.adjustment_credit ?? 0); // debits are income, credits are given away
    const revenue = shippingRevenue + weightRevenue + creditsRevenue + adjustmentsNet;
    const profit = revenue - courierCost;
    const consumed = -((l.reserve_settle ?? 0) + (l.weight_charge ?? 0) + (l.credits_purchase ?? 0) + (l.store_plan ?? 0) + (l.store_fee ?? 0) + (l.adjustment_debit ?? 0) + (l.refund_debit ?? 0) + (l.rto_charge ?? 0)) - (l.weight_reversal ?? 0) - (l.refund_credit ?? 0) - (l.rto_credit ?? 0);
    return {
      orgId: id, name: String(o.name ?? id), shipments: n(s?.shipments), shippingGross, shippingRevenue, courierCost, quotedCost: n(s?.quoted), carrierExtra: n(s?.extra),
      weightNet, weightRevenue, creditsRevenue, adjustmentsNet, revenue, profit, marginPct: revenue > 0 ? Math.round((profit * 1000) / revenue) / 10 : null,
      gstCollected: shippingGross - shippingRevenue + Math.max(weightNet, 0) - pre(Math.max(weightNet, 0)),
      recharged: l.recharge_credit ?? 0, walletBalance: W.get(id) ?? 0, consumed, fodFreight: n(s?.fod), openDisputes: D.get(id) ?? 0, lossShipments: n(s?.loss),
    };
  });
  rows.sort((a, b) => b.profit - a.profit);
  // the owner's own accounts are left out of the overall P&L (a single customer's own P&L still shows them)
  const ownIds = new Set(orgId ? [] : await ownAccountIds());
  const own = rows.filter((r) => ownIds.has(r.orgId));
  const counted = rows.filter((r) => !ownIds.has(r.orgId));
  const keys: Array<keyof PnlRow> = ["shipments", "shippingGross", "shippingRevenue", "courierCost", "quotedCost", "carrierExtra", "weightNet", "weightRevenue", "creditsRevenue", "adjustmentsNet", "revenue", "profit", "gstCollected", "recharged", "walletBalance", "consumed", "fodFreight", "openDisputes", "lossShipments"];
  const total = { orgId: "all", name: "All customers", marginPct: null } as PnlRow;
  for (const k of keys) (total as Record<string, unknown>)[k] = counted.reduce((t, r) => t + (r[k] as number), 0);
  total.marginPct = total.revenue > 0 ? Math.round((total.profit * 1000) / total.revenue) / 10 : null;
  return { rows: counted, own, total, gstBps };
}
