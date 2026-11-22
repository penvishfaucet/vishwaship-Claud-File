import "server-only";
import { and, eq, gte, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { orgSetting, saveOrgSetting } from "@/server/couriers";
import { getDb, schema } from "@/server/db/client";
import { getSetting } from "@/server/quotes/service";
import type { Line } from "./checkout";
import { EXPENSE_CATEGORIES, type ExpenseCategory } from "./expenses";

/**
 * Store profit & loss for the MERCHANT (their own money, never Vishwaship's courier cost).
 *
 * Basis: a sale counts when it is delivered (the shipment's delivery date). An RTO / lost order counts on the date it
 * turned RTO: no sale, but its shipping and the goods that did not come back sellable are a loss. Orders still on
 * the way are "pending" and kept apart. Every amount is paise; each event is counted once.
 *
 * Order contribution = net sales (ex-GST) + shipping collected (ex-GST) − product cost − shipping paid − payment fees
 *                      − expenses tagged to the order
 * Store net          = Σ contributions − store-level expenses (incl. the Online Store plan) in the period
 * Margin %           = net ÷ (net sales + shipping collected) × 100, blank when that is 0
 * GST: when the merchant is GST-registered, output GST on sales and shipping collected is shown apart, and the GST on
 * Vishwaship shipping invoices and on expenses marked "claimable" is input credit (not a cost). Otherwise all GST paid
 * is part of the cost and there is no output GST.
 */
export type PnlSettings = { gstRegistered: boolean; gatewayFeeBps: number };
const KEY = "store_pnl";

export async function pnlSettings(orgId: string): Promise<PnlSettings> {
  const s = await orgSetting<Partial<PnlSettings>>(orgId, KEY);
  const db = await getDb();
  const [o] = await db.select({ gstin: schema.orgs.gstin }).from(schema.orgs).where(eq(schema.orgs.id, orgId));
  return { gstRegistered: s?.gstRegistered ?? !!o?.gstin, gatewayFeeBps: s?.gatewayFeeBps ?? 0 };
}
export async function savePnlSettings(orgId: string, userId: string, v: PnlSettings) {
  await saveOrgSetting(orgId, KEY, { gstRegistered: v.gstRegistered, gatewayFeeBps: Math.max(0, Math.min(1000, Math.round(v.gatewayFeeBps))) }, userId);
}

const istStart = (d: string) => new Date(`${d}T00:00:00+05:30`);
const istEnd = (d: string) => new Date(`${d}T23:59:59.999+05:30`);
export const istDate = (d: Date) => new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
const exGst = (gross: number, bps: number) => Math.round((gross * 10_000) / (10_000 + bps));

export type OrderPnl = {
  id: string; number: string; date: string; outcome: "delivered" | "rto" | "lost"; method: string;
  netSales: number; shippingCollected: number; productCost: number; shippingPaid: number; paymentFees: number; orderExpenses: number; contribution: number;
  outputGst: number; inputGst: number; flags: string[];
};
type Range = { from: string; to: string };

async function compute(orgId: string, r: Range) {
  const db = await getDb();
  const st = await pnlSettings(orgId);
  const shipGstBps = Number((await getSetting<number>("gst_bps", 1800)).value) || 1800;
  const from = istStart(r.from), to = istEnd(r.to);

  // orders that reached their outcome in the range (delivery, RTO or loss), from their shipment's own events
  const S = schema.shipments, O = schema.storeOrders, E = schema.shipmentEvents;
  const rows = await db.select({ o: O, s: S }).from(O).innerJoin(S, eq(S.orderId, O.shippingOrderId))
    .where(and(eq(O.orgId, orgId), eq(O.status, "placed"), eq(S.bookingStatus, "confirmed"), ne(S.status, "cancelled"),
      gte(O.createdAt, new Date(from.getTime() - 400 * 86_400_000)))).limit(20_000);
  const shipIds = rows.map((x) => x.s.id);
  const ev = shipIds.length ? await db.select({ id: E.shipmentId, status: E.status, at: sql<Date>`min(${E.occurredAt})` }).from(E)
    .where(and(inArray(E.shipmentId, shipIds), sql`(${E.status} = 'delivered' or ${E.status} like 'rto%' or ${E.status} = 'lost')`)).groupBy(E.shipmentId, E.status) : [];
  const firstAt = (id: string, test: (s: string) => boolean) => ev.filter((e) => e.id === id && test(e.status)).map((e) => new Date(e.at)).sort((a, b) => +a - +b)[0] ?? null;
  const disputes = shipIds.length ? await db.select({ id: schema.weightDisputes.shipmentId, amt: schema.weightDisputes.chargePaise, status: schema.weightDisputes.status }).from(schema.weightDisputes)
    .where(and(eq(schema.weightDisputes.orgId, orgId), inArray(schema.weightDisputes.shipmentId, shipIds))) : [];
  // RTO charges settled in the wallet after booking (debits are negative, reductions positive)
  const rtoL = shipIds.length ? await db.select({ id: schema.ledgerEntries.refId, amt: schema.ledgerEntries.amountPaise }).from(schema.ledgerEntries)
    .where(and(eq(schema.ledgerEntries.refType, "shipment"), inArray(schema.ledgerEntries.refId, shipIds), inArray(schema.ledgerEntries.kind, ["rto_charge", "rto_credit"]))) : [];
  const orderIds = rows.map((x) => x.o.id);
  const tagged = orderIds.length ? await db.select().from(schema.storeExpenses).where(and(inArray(schema.storeExpenses.storeOrderId, orderIds), isNull(schema.storeExpenses.deletedAt))) : [];
  // current unit costs, only as an estimate for orders shipped before costs were captured
  const pids = [...new Set(rows.flatMap((x) => (x.o.lines as Line[]).map((l) => l.productId)))];
  const curP = pids.length ? await db.select({ id: schema.storeProducts.id, c: schema.storeProducts.unitCostPaise }).from(schema.storeProducts).where(inArray(schema.storeProducts.id, pids)) : [];
  const curV = pids.length ? await db.select({ id: schema.storeProductVariants.id, c: schema.storeProductVariants.unitCostPaise }).from(schema.storeProductVariants).where(inArray(schema.storeProductVariants.productId, pids)) : [];
  const expNet = (e: { amountPaise: number; gstPaise: number; gstRecoverable: boolean }) => (st.gstRegistered && e.gstRecoverable ? e.amountPaise - e.gstPaise : e.amountPaise);

  const orders: OrderPnl[] = [];
  let pendingCount = 0, pendingValue = 0;
  const seen = new Set<string>();
  for (const { o, s } of rows) {
    if (seen.has(o.id)) continue; seen.add(o.id);
    const isRto = s.status.startsWith("rto") || s.status === "lost";
    // delivery date, or the first RTO / lost scan (the shipment's last scan time when the events are missing)
    const at = s.status === "delivered" ? (s.deliveredAt ?? firstAt(s.id, (x) => x === "delivered") ?? s.lastEventAt) : isRto ? (firstAt(s.id, (x) => x !== "delivered") ?? s.lastEventAt) : null;
    if (s.status !== "delivered" && !isRto) { pendingCount++; pendingValue += o.totalPaise; continue; }
    if (!at || at < from || at > to) continue;
    const outcome: OrderPnl["outcome"] = s.status === "delivered" ? "delivered" : s.status === "lost" ? "lost" : "rto";
    const lines = o.lines as Line[];
    const flags: string[] = [];
    // sales and output GST (prices are GST-inclusive; the discount is spread over the lines by value)
    const sub = o.subtotalPaise || 1, share = 1 - o.discountPaise / sub;
    let netSales = 0, outputGst = 0, shippingCollected = 0;
    if (outcome === "delivered") {
      for (const l of lines) {
        const gross = l.unitPaise * l.qty * share;
        const gst = st.gstRegistered ? (gross * l.taxBps) / (10_000 + l.taxBps) : 0;
        netSales += gross - gst; outputGst += gst;
      }
      const shipGross = o.shippingPaise + o.codFeePaise;
      const shipGst = st.gstRegistered ? shipGross - exGst(shipGross, shipGstBps) : 0;
      shippingCollected = shipGross - shipGst; outputGst += shipGst;
    }
    // product cost: captured when the goods left; RTO keeps only what did not come back sellable
    const costs = (o.costs as Array<{ productId: string; variantId: string | null; qty: number; unitCostPaise: number | null }> | null) ?? null;
    let productCost = 0;
    const insp = (o.returnInspection as { lines: Array<{ sellable: number }> } | null)?.lines ?? null;
    lines.forEach((l, i) => {
      let unit = costs?.find((c) => c.productId === l.productId && c.variantId === l.variantId)?.unitCostPaise ?? null;
      if (unit === null && !costs) {
        unit = (l.variantId ? curV.find((v) => v.id === l.variantId)?.c : null) ?? curP.find((p) => p.id === l.productId)?.c ?? null;
        if (unit !== null && !flags.includes("cost estimated")) flags.push("cost estimated");
      }
      if (unit === null) { if (!flags.includes("cost missing")) flags.push("cost missing"); return; }
      const back = outcome === "delivered" ? 0 : insp?.[i]?.sellable ?? 0;
      productCost += unit * (l.qty - back);
    });
    if (outcome !== "delivered" && !insp) flags.push("return not counted yet");
    // shipping paid to Vishwaship (booking charge + weight charges), GST credit when registered
    const weight = disputes.filter((d) => d.id === s.id && ["charged", "accepted"].includes(d.status)).reduce((t, d) => t + (d.amt ?? 0), 0);
    const rtoCharge = -rtoL.filter((l) => l.id === s.id).reduce((t, l) => t + l.amt, 0);
    const shipPaidGross = s.sellPaise + weight + rtoCharge;
    const shippingPaid = st.gstRegistered ? exGst(shipPaidGross, shipGstBps) : shipPaidGross;
    let inputGst = st.gstRegistered ? shipPaidGross - shippingPaid : 0;
    const paymentFees = o.paymentMethod !== "cod" && st.gatewayFeeBps ? Math.round((o.totalPaise * st.gatewayFeeBps) / 10_000) : 0;
    if (paymentFees) flags.push("payment fee estimated");
    const mine = tagged.filter((e) => e.storeOrderId === o.id);
    const orderExpenses = mine.reduce((t, e) => t + expNet(e), 0);
    inputGst += mine.filter((e) => st.gstRegistered && e.gstRecoverable).reduce((t, e) => t + e.gstPaise, 0);
    const R = Math.round;
    const row = { netSales: R(netSales), shippingCollected: R(shippingCollected), productCost: R(productCost), shippingPaid, paymentFees, orderExpenses };
    orders.push({
      id: o.id, number: o.number, date: istDate(at), outcome, method: o.paymentMethod, ...row, outputGst: R(outputGst), inputGst, flags,
      contribution: row.netSales + row.shippingCollected - row.productCost - row.shippingPaid - row.paymentFees - row.orderExpenses,
    });
  }
  orders.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.number < b.number ? 1 : -1));

  // store-level expenses in the range (not tagged to an order) + the Online Store plan charged from the wallet
  const ex = await db.select().from(schema.storeExpenses).where(and(eq(schema.storeExpenses.orgId, orgId), isNull(schema.storeExpenses.deletedAt), isNull(schema.storeExpenses.storeOrderId),
    gte(schema.storeExpenses.spentOn, r.from), lte(schema.storeExpenses.spentOn, r.to)));
  const overhead = new Map<string, number>();
  let overheadInputGst = 0, nonRecoverableGst = 0;
  for (const e of ex) {
    overhead.set(e.category, (overhead.get(e.category) ?? 0) + expNet(e));
    if (st.gstRegistered && e.gstRecoverable) overheadInputGst += e.gstPaise; else nonRecoverableGst += e.gstPaise;
  }
  const plan = await db.execute(sql`select coalesce(sum(-l.amount_paise), 0)::bigint as amt from ledger_entries l join wallets w on w.id = l.wallet_id
    where w.org_id = ${orgId} and l.kind in ('store_plan') and l.created_at >= ${from} and l.created_at <= ${to}`);
  const planRows = (plan as unknown as { rows?: Array<{ amt: unknown }> }).rows ?? (plan as unknown as Array<{ amt: unknown }>);
  const planGross = Number(planRows[0]?.amt ?? 0);
  if (planGross) {
    const net = st.gstRegistered ? exGst(planGross, shipGstBps) : planGross;
    overhead.set("vishwaship_plan", net);
    overheadInputGst += planGross - net;
  }
  const sum = (k: keyof OrderPnl) => orders.reduce((t, x) => t + (x[k] as number), 0);
  const overheadTotal = [...overhead.values()].reduce((t, v) => t + v, 0);
  const revenue = sum("netSales") + sum("shippingCollected");
  const contribution = sum("contribution");
  const net = contribution - overheadTotal;
  const outputGst = sum("outputGst"), inputGst = sum("inputGst") + overheadInputGst;
  return {
    settings: st,
    summary: {
      delivered: orders.filter((x) => x.outcome === "delivered").length, rto: orders.filter((x) => x.outcome !== "delivered").length,
      netSales: sum("netSales"), shippingCollected: sum("shippingCollected"), revenue, productCost: sum("productCost"), shippingPaid: sum("shippingPaid"),
      paymentFees: sum("paymentFees"), orderExpenses: sum("orderExpenses"), contribution, overhead: overheadTotal, net,
      marginPct: revenue > 0 ? Math.round((net / revenue) * 1000) / 10 : null,
      rtoLoss: orders.filter((x) => x.outcome !== "delivered").reduce((t, x) => t + x.contribution, 0),
      pending: { count: pendingCount, valuePaise: pendingValue },
      incomplete: orders.filter((x) => x.flags.includes("cost missing")).length,
    },
    gst: { registered: st.gstRegistered, output: outputGst, inputRecoverable: inputGst, nonRecoverable: nonRecoverableGst, payable: outputGst - inputGst },
    overhead: [...overhead.entries()].map(([k, v]) => ({ key: k, label: k === "vishwaship_plan" ? "Vishwaship Online Store plan" : EXPENSE_CATEGORIES[k as ExpenseCategory]?.label ?? k, amount: v })).sort((a, b) => b.amount - a.amount),
    orders,
  };
}

/** P&L for a range plus the same-length period just before it (for comparison). */
export async function storePnl(orgId: string, r: Range) {
  const cur = await compute(orgId, r);
  const days = Math.round((istStart(r.to).getTime() - istStart(r.from).getTime()) / 86_400_000) + 1;
  const pTo = istDate(new Date(istStart(r.from).getTime() - 86_400_000 + 12 * 3600_000));
  const pFrom = istDate(new Date(istStart(r.from).getTime() - days * 86_400_000 + 12 * 3600_000));
  const prev = await compute(orgId, { from: pFrom, to: pTo });
  return { ...cur, range: r, previous: { range: { from: pFrom, to: pTo }, summary: prev.summary } };
}

export const ORDER_COLS = ["Date", "Order", "Outcome", "Payment", "Net sales (ex-GST)", "Shipping collected", "Product cost", "Shipping paid", "Payment fees", "Order expenses", "Contribution", "Output GST", "Input GST", "Notes"];
export const orderRow = (x: OrderPnl) => [x.date, x.number, x.outcome === "delivered" ? "Delivered" : x.outcome === "lost" ? "Lost" : "RTO", x.method === "cod" ? "COD" : "Prepaid",
  ...[x.netSales, x.shippingCollected, x.productCost, x.shippingPaid, x.paymentFees, x.orderExpenses, x.contribution, x.outputGst, x.inputGst].map((p) => Math.round(p) / 100), x.flags.join("; ")];
