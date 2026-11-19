import "server-only";
import { and, desc, eq, gte, inArray, lte, ne } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { METHOD_LABEL, rechargeStatus } from "@/lib/recharge";

/**
 * Wallet passbook: every posted wallet entry (recharges, shipment charges, refunds, adjustments) plus recharges that
 * did NOT credit the wallet (pending / failed / cancelled …), in one chronological list. Uncredited recharges carry
 * their status and never count as money in the wallet.
 */
export type PassbookType = "recharge" | "shipment" | "refund" | "adjustment" | "other";
export const PASSBOOK_TYPES: Array<{ key: PassbookType | "all"; label: string }> = [
  { key: "all", label: "All transactions" }, { key: "recharge", label: "Recharges" }, { key: "shipment", label: "Shipment charges" },
  { key: "refund", label: "Refunds" }, { key: "adjustment", label: "Adjustments" }, { key: "other", label: "Other" },
];
export type PassbookItem = {
  id: string; at: Date; type: PassbookType; title: string;
  /** credit = money in, debit = money out, none = recorded but not credited (e.g. a failed recharge) */
  direction: "credit" | "debit" | "none"; amountPaise: number;
  status: string; statusChip: string; description: string;
  reference: string | null; orderId: string | null; orderNumber: string | null; awb: string | null; rechargeId: string | null;
  balanceAfterPaise: number | null;
};

const KIND: Record<string, { type: PassbookType; title: string }> = {
  recharge_credit: { type: "recharge", title: "Wallet Recharge" },
  reserve_settle: { type: "shipment", title: "Shipment Charge" },
  weight_charge: { type: "shipment", title: "Weight Charge" },
  refund_credit: { type: "refund", title: "Refund" },
  weight_reversal: { type: "refund", title: "Weight Charge Reversed" },
  refund_debit: { type: "refund", title: "Refund Reversal" },
  adjustment_credit: { type: "adjustment", title: "Adjustment (credit)" },
  adjustment_debit: { type: "adjustment", title: "Adjustment (debit)" },
  credits_purchase: { type: "other", title: "Notification Credits" },
};

export async function passbookHistory(orgId: string, o: { from: Date; to: Date; type?: PassbookType | "all"; limit?: number }): Promise<PassbookItem[]> {
  const db = await getDb();
  const [w] = await db.select().from(schema.wallets).where(eq(schema.wallets.orgId, orgId));
  const entries = w ? await db.select().from(schema.ledgerEntries)
    .where(and(eq(schema.ledgerEntries.walletId, w.id), ne(schema.ledgerEntries.amountPaise, 0), gte(schema.ledgerEntries.createdAt, o.from), lte(schema.ledgerEntries.createdAt, o.to)))
    .orderBy(desc(schema.ledgerEntries.createdAt)).limit(o.limit ?? 1000) : [];
  // references behind each entry: shipment → order + AWB, order, recharge → payment reference
  const shipIds = entries.filter((e) => e.refType === "shipment" && e.refId).map((e) => e.refId!);
  const ships = shipIds.length ? await db.select({ id: schema.shipments.id, awb: schema.shipments.awb, orderId: schema.orders.id, orderNumber: schema.orders.orderNumber })
    .from(schema.shipments).innerJoin(schema.orders, eq(schema.orders.id, schema.shipments.orderId)).where(and(eq(schema.shipments.orgId, orgId), inArray(schema.shipments.id, shipIds))) : [];
  const orderIds = entries.filter((e) => e.refType === "order" && e.refId).map((e) => e.refId!);
  const orders = orderIds.length ? await db.select({ id: schema.orders.id, orderNumber: schema.orders.orderNumber }).from(schema.orders).where(and(eq(schema.orders.orgId, orgId), inArray(schema.orders.id, orderIds))) : [];
  const rechargeIds = entries.filter((e) => e.refType === "recharge" && e.refId).map((e) => e.refId!);
  const allRecharges = await db.select().from(schema.recharges).where(and(eq(schema.recharges.orgId, orgId), gte(schema.recharges.createdAt, o.from), lte(schema.recharges.createdAt, o.to)));
  const linked = rechargeIds.length ? await db.select().from(schema.recharges).where(and(eq(schema.recharges.orgId, orgId), inArray(schema.recharges.id, rechargeIds))) : [];
  const rcById = new Map([...allRecharges, ...linked].map((r) => [r.id, r]));
  const payRef = (r: typeof schema.recharges.$inferSelect | undefined) => r ? r.razorpayPaymentId ?? r.providerPaymentId ?? r.utr ?? r.requestNumber ?? r.razorpayOrderId ?? null : null;

  const items: PassbookItem[] = entries.map((e) => {
    const k = KIND[e.kind] ?? { type: "other" as const, title: e.kind.replace(/_/g, " ") };
    const sh = e.refType === "shipment" ? ships.find((x) => x.id === e.refId) : undefined;
    const od = e.refType === "order" ? orders.find((x) => x.id === e.refId) : undefined;
    const rc = e.refType === "recharge" ? rcById.get(e.refId ?? "") : undefined;
    return {
      id: e.id, at: e.createdAt, type: k.type, title: k.title, direction: e.amountPaise > 0 ? "credit" : "debit", amountPaise: Math.abs(e.amountPaise),
      status: "Successful", statusChip: "c-active", description: e.memo ?? k.title,
      reference: rc ? payRef(rc) : e.refType && !sh && !od ? e.refId : null, orderId: sh?.orderId ?? od?.id ?? null, orderNumber: sh?.orderNumber ?? od?.orderNumber ?? null, awb: sh?.awb ?? null,
      rechargeId: rc?.id ?? null, balanceAfterPaise: e.balanceAfterPaise,
    };
  });
  // recharges that did not (or not yet) credit the wallet: shown with their status, never as a credit
  for (const r of allRecharges) {
    if (r.status === "credited") continue;
    const st = rechargeStatus(r.status);
    items.push({
      id: `rc_${r.id}`, at: r.createdAt, type: "recharge", title: "Wallet Recharge", direction: "none", amountPaise: r.amountPaise,
      status: st.label, statusChip: st.chip, description: `${METHOD_LABEL[r.method] ?? r.method} recharge — not credited${r.status === "payment_pending" || r.status === "pending_verification" ? " yet" : ""}`,
      reference: payRef(r), orderId: null, orderNumber: null, awb: null, rechargeId: r.id, balanceAfterPaise: null,
    });
  }
  const typed = o.type && o.type !== "all" ? items.filter((i) => i.type === o.type) : items;
  return typed.sort((a, b) => +b.at - +a.at);
}
