import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";

/**
 * Delivery insights from Vishwaship's own shipment history (all clients, aggregated — never another
 * client's orders or names):
 *  - per courier, for a delivery PIN: how many finished shipments were delivered vs returned (RTO);
 *    a PIN with too few shipments falls back to its 3-digit area.
 *  - per buyer mobile number: how often they accepted delivery vs refused / returned, and COD history.
 */
const MIN_PIN = 5, MIN_AREA = 5;
export type CarrierStat = { carrierCode: string; carrierName: string; delivered: number; rto: number; finished: number; deliveredPct: number; rtoPct: number; scope: "pin" | "area" };
export type BuyerStat = { orders: number; finished: number; delivered: number; returned: number; codOrders: number; codDelivered: number; codReturned: number; codRejectedOnWhatsapp: number; acceptPct: number | null; label: "new" | "trusted" | "watch" | "risky" };

const DELIVERED = sql`'delivered'`;
const RETURNED = sql`'rto_initiated','rto_in_transit','rto_delivered'`;

type Row = { carrier_code: string; carrier_name: string; delivered: number | string; rto: number | string };
const pct = (a: number, b: number) => (b ? Math.round((a * 1000) / b) / 10 : 0);

/** Courier delivery and RTO rates for a delivery PIN (falls back to the PIN's 3-digit area). */
export async function pinInsights(pin: string): Promise<Record<string, CarrierStat>> {
  if (!/^[1-9]\d{5}$/.test(pin)) return {};
  const db = await getDb();
  const q = (where: ReturnType<typeof sql>) => db.execute(sql`
    select s.carrier_code, max(s.carrier_name) as carrier_name,
      count(*) filter (where s.status = ${DELIVERED})::int as delivered,
      count(*) filter (where s.status in (${RETURNED}))::int as rto
    from shipments s join orders o on o.id = s.order_id
    where s.booking_status = 'confirmed' and o.direction = 'forward' and ${where}
    group by s.carrier_code`);
  const rowsOf = (r: unknown) => ((r as { rows?: Row[] }).rows ?? (r as Row[])) as Row[];
  const [pinRows, areaRows] = await Promise.all([q(sql`o.consignee->>'pincode' = ${pin}`), q(sql`left(o.consignee->>'pincode', 3) = ${pin.slice(0, 3)}`)]);
  const out: Record<string, CarrierStat> = {};
  const add = (r: Row, scope: "pin" | "area") => {
    const d = Number(r.delivered), x = Number(r.rto), f = d + x;
    out[r.carrier_code] = { carrierCode: r.carrier_code, carrierName: r.carrier_name, delivered: d, rto: x, finished: f, deliveredPct: pct(d, f), rtoPct: pct(x, f), scope };
  };
  for (const r of rowsOf(areaRows)) if (Number(r.delivered) + Number(r.rto) >= MIN_AREA) add(r, "area");
  for (const r of rowsOf(pinRows)) if (Number(r.delivered) + Number(r.rto) >= MIN_PIN) add(r, "pin");
  return out;
}

/** A buyer's record by mobile number (last 10 digits) across Vishwaship. */
export async function buyerInsights(mobile: string): Promise<BuyerStat | null> {
  const m = String(mobile ?? "").replace(/\D/g, "").slice(-10);
  if (!/^[6-9]\d{9}$/.test(m)) return null;
  const db = await getDb();
  const r = await db.execute(sql`
    select
      count(distinct o.id)::int as orders,
      count(*) filter (where s.status = ${DELIVERED})::int as delivered,
      count(*) filter (where s.status in (${RETURNED}))::int as returned,
      count(distinct o.id) filter (where o.cod_amount_paise > 0)::int as cod_orders,
      count(*) filter (where o.cod_amount_paise > 0 and s.status = ${DELIVERED})::int as cod_delivered,
      count(*) filter (where o.cod_amount_paise > 0 and s.status in (${RETURNED}))::int as cod_returned,
      (select count(*)::int from cod_confirmations c join orders o2 on o2.id = c.order_id
        where c.status = 'rejected' and right(regexp_replace(o2.consignee->>'mobile', '\\D', '', 'g'), 10) = ${m}) as rejected
    from orders o left join shipments s on s.order_id = o.id and s.booking_status = 'confirmed'
    where o.direction = 'forward' and right(regexp_replace(o.consignee->>'mobile', '\\D', '', 'g'), 10) = ${m}`);
  const row = (((r as { rows?: Array<Record<string, number>> }).rows ?? (r as unknown as Array<Record<string, number>>))[0] ?? {}) as Record<string, number>;
  const delivered = Number(row.delivered ?? 0), returned = Number(row.returned ?? 0), finished = delivered + returned;
  const rejected = Number(row.rejected ?? 0);
  const acceptPct = finished ? pct(delivered, finished + rejected) : rejected ? 0 : null;
  // one bad experience alone is a "watch", not a verdict
  const events = finished + rejected;
  const label: BuyerStat["label"] = acceptPct === null ? "new" : acceptPct >= 80 ? "trusted" : acceptPct >= 50 || events < 2 ? "watch" : "risky";
  return { orders: Number(row.orders ?? 0), finished, delivered, returned, codOrders: Number(row.cod_orders ?? 0), codDelivered: Number(row.cod_delivered ?? 0), codReturned: Number(row.cod_returned ?? 0), codRejectedOnWhatsapp: rejected, acceptPct, label };
}
