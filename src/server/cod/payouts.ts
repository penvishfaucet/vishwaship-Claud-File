import "server-only";
import { and, eq, inArray, isNull, gt } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { dbLedgerStore } from "@/server/ledger/db-store";
import { credit, debit } from "@/server/ledger/wallet";
import { decrypt, encrypt } from "@/server/security/crypto";
import { codFeesFor, feeRates } from "@/server/store/fee";
import { newId } from "@/server/util/ids";

/**
 * Paying clients their COD (owner 2026-11-24): same day / next day after the courier pays Vishwaship, in one click.
 *
 * What is paid, per shipment (delivered COD, never paid before):
 *   - the courier has paid this AWB in full ("matched"), or staff accepted the courier's amount ("accepted"), or
 *   - the client has Early COD: paid D+N after delivery (its fee applies) without waiting for the courier.
 * Per client:
 *   gross   COD of those shipments (an accepted amount where staff accepted one)
 *   − Online Store fee 1.5% + GST on delivered COD orders from the client's online store (store/fee.ts)
 *   − Early COD fee + GST (Early COD clients only)
 *   − dues: a negative wallet balance is cleared from the COD (credited to the wallet as "Dues Paid from COD")
 *   = net, paid to the client's payout bank account.
 * A client without a payout bank account is skipped (its COD waits). Cancelling a payout returns its shipments to the
 * next run and reverses the dues credit.
 */

export type PayoutShipment = { shipmentId: string; awb: string | null; orderNumber: string; codPaise: number; basis: "courier" | "early" };
export type OrgPayout = {
  orgId: string; name: string; shipments: PayoutShipment[]; grossPaise: number;
  storeFeePaise: number; storeOrders: number; earlyFeePaise: number; earlyGstPaise: number; duesPaise: number; netPaise: number;
  early: boolean; earlyFeeBps: number | null; bank: { holderName: string; last4: string; ifsc: string; bankName: string | null } | null;
  blocked: string | null; awaitingCourier: number; awaitingCourierPaise: number;
};

const DAY = 86_400_000;

type Q = Awaited<ReturnType<typeof getDb>> | Parameters<Parameters<Awaited<ReturnType<typeof getDb>>["transaction"]>[0]>[0];

/** What would be paid now, per client (nothing is written). `orgIds` limits it to some clients. */
export async function payoutPreview(now = new Date(), orgIds?: string[], q?: Q): Promise<OrgPayout[]> {
  const db = q ?? (await getDb());
  const S = schema.shipments, O = schema.orders, R = schema.codReceipts;
  const rows = await db.select({ s: S, o: O, r: R, name: schema.orgs.businessName }).from(S).innerJoin(O, eq(O.id, S.orderId)).innerJoin(schema.orgs, eq(schema.orgs.id, S.orgId))
    .leftJoin(schema.codRemittanceItems, eq(schema.codRemittanceItems.shipmentId, S.id)).leftJoin(R, eq(R.shipmentId, S.id))
    .where(and(eq(O.paymentType, "cod"), gt(O.codAmountPaise, 0), eq(S.status, "delivered"), isNull(schema.codRemittanceItems.shipmentId), ...(orgIds?.length ? [inArray(S.orgId, orgIds)] : [])));
  if (!rows.length) return [];
  const orgs = [...new Set(rows.map((r) => r.s.orgId))];
  const subs = await db.select().from(schema.earlyCodSubscriptions).where(and(inArray(schema.earlyCodSubscriptions.orgId, orgs), eq(schema.earlyCodSubscriptions.status, "active")));
  const sub = new Map(subs.map((x) => [x.orgId, x]));
  const banks = await db.select().from(schema.orgPayoutAccounts).where(inArray(schema.orgPayoutAccounts.orgId, orgs));
  const bank = new Map(banks.map((b) => [b.orgId, b]));
  const wallets = await db.select().from(schema.wallets).where(inArray(schema.wallets.orgId, orgs));
  const wallet = new Map(wallets.map((w) => [w.orgId, w]));
  const rates = await feeRatesOnce();
  const out: OrgPayout[] = [];
  for (const orgId of orgs) {
    const mine = rows.filter((r) => r.s.orgId === orgId);
    const e = sub.get(orgId);
    const ships: PayoutShipment[] = [];
    let awaiting = 0, awaitingPaise = 0;
    for (const { s, o, r } of mine) {
      const paid = r && (r.status === "matched" || r.status === "accepted");
      const deliveredAt = s.deliveredAt ?? s.lastEventAt ?? s.createdAt;
      if (paid) ships.push({ shipmentId: s.id, awb: s.awb, orderNumber: o.orderNumber, codPaise: r!.status === "accepted" ? r!.amountPaise : o.codAmountPaise, basis: "courier" });
      else if (e && +deliveredAt + e.cycleDays * DAY <= +now) ships.push({ shipmentId: s.id, awb: s.awb, orderNumber: o.orderNumber, codPaise: o.codAmountPaise, basis: "early" });
      else { awaiting++; awaitingPaise += o.codAmountPaise; }
    }
    const gross = ships.reduce((t, x) => t + x.codPaise, 0);
    const sf = ships.length ? await codFeesFor(db, ships.map((x) => x.shipmentId), rates, false) : { totalPaise: 0, orders: 0 };
    const earlyFee = e ? Math.round((gross * e.feeBps) / 10_000) : 0;
    const earlyGst = Math.round((earlyFee * rates.gstBps) / 10_000);
    const afterFees = Math.max(0, gross - sf.totalPaise - earlyFee - earlyGst);
    const w = wallet.get(orgId);
    const dues = w && w.postedPaise < 0 ? Math.min(-w.postedPaise, afterFees) : 0;
    const b = bank.get(orgId);
    const net = afterFees - dues;
    out.push({
      orgId, name: mine[0].name, shipments: ships, grossPaise: gross, storeFeePaise: sf.totalPaise, storeOrders: sf.orders, earlyFeePaise: earlyFee, earlyGstPaise: earlyGst, duesPaise: dues, netPaise: net,
      early: !!e, earlyFeeBps: e?.feeBps ?? null, bank: b ? { holderName: b.holderName, last4: b.accountLast4, ifsc: b.ifsc, bankName: b.bankName } : null,
      blocked: !ships.length ? "Waiting for the courier's COD" : !b && net > 0 ? "No payout bank account" : null,
      awaitingCourier: awaiting, awaitingCourierPaise: awaitingPaise,
    });
  }
  return out.sort((a, b) => b.netPaise - a.netPaise);
}

let ratesCache: { at: number; v: Awaited<ReturnType<typeof feeRates>> } | null = null;
async function feeRatesOnce() {
  if (!ratesCache || Date.now() - ratesCache.at > 60_000) ratesCache = { at: Date.now(), v: await feeRates() };
  return ratesCache.v;
}

/**
 * "Pay all": one payout per ready client (bank account present, something to pay). Payouts are created "scheduled";
 * the bank file (bankFileCsv) is uploaded to the bank, then the UTR marks them paid. A payout whose COD is all used
 * for dues (net 0) is closed at once.
 */
export async function createPayoutRun(actorUserId: string | null, orgIds?: string[], now = new Date()) {
  const db = await getDb();
  const runId = newId("run");
  const rates = await feeRatesOnce();
  const made: Array<{ id: string; orgId: string; name: string; netPaise: number; shipments: number }> = [];
  const skipped: Array<{ orgId: string; name: string; reason: string }> = [];
  for (const p of await payoutPreview(now, orgIds)) {
    if (p.blocked) { if (p.shipments.length) skipped.push({ orgId: p.orgId, name: p.name, reason: p.blocked }); continue; }
    const id = newId("rem");
    const res = await db.transaction(async (tx) => {
      // recomputed inside the transaction: a shipment taken by another run meanwhile is not paid twice (unique item)
      const [fresh] = await payoutPreview(now, [p.orgId], tx);
      if (!fresh || fresh.blocked || !fresh.shipments.length) return null;
      const sf = await codFeesFor(tx, fresh.shipments.map((x) => x.shipmentId), rates, true);
      const notes = [
        sf.orders ? `Online Store fee ${rates.feeBps / 100}% + GST on ${sf.orders} delivered COD order${sf.orders === 1 ? "" : "s"} (₹${(sf.totalPaise / 100).toFixed(2)})` : null,
        fresh.earlyFeePaise ? `Early COD fee ${(fresh.earlyFeeBps ?? 0) / 100}% + GST (₹${((fresh.earlyFeePaise + fresh.earlyGstPaise) / 100).toFixed(2)})` : null,
        fresh.duesPaise ? `Wallet dues cleared (₹${(fresh.duesPaise / 100).toFixed(2)})` : null,
      ].filter(Boolean);
      const ded = sf.totalPaise + fresh.earlyFeePaise + fresh.earlyGstPaise + fresh.duesPaise;
      const net = fresh.grossPaise - ded;
      const closed = net <= 0;
      await tx.insert(schema.codRemittances).values({
        id, orgId: p.orgId, cycleDate: now, expectedPayoutAt: now, grossPaise: fresh.grossPaise, deductionsPaise: ded, netPaise: Math.max(0, net), deductionNote: notes.length ? notes.join(" · ") : null,
        status: closed ? "paid" : "scheduled", reference: closed ? "Adjusted against dues" : null, paidAt: closed ? now : null,
        earlyCod: fresh.shipments.some((x) => x.basis === "early"), walletOffsetPaise: fresh.duesPaise, runId, createdBy: actorUserId,
      });
      await tx.insert(schema.codRemittanceItems).values(fresh.shipments.map((x) => ({ remittanceId: id, shipmentId: x.shipmentId, codPaise: x.codPaise })));
      if (fresh.duesPaise > 0) {
        const [w] = await tx.select().from(schema.wallets).where(eq(schema.wallets.orgId, p.orgId));
        if (w) await credit(dbLedgerStore(tx), { walletId: w.id, amount: fresh.duesPaise, kind: "cod_offset", idempotencyKey: `codoffset:${id}`, refType: "cod_remittance", refId: id, memo: `Dues paid from COD payout ${id}` });
      }
      return { net: Math.max(0, net), n: fresh.shipments.length };
    });
    if (res) made.push({ id, orgId: p.orgId, name: p.name, netPaise: res.net, shipments: res.n });
  }
  return { runId, made, skipped };
}

/** Cancel a scheduled payout: its shipments go back to the next run; the dues credit is reversed. */
export async function cancelPayout(id: string) {
  const db = await getDb();
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(schema.codRemittances).where(and(eq(schema.codRemittances.id, id), eq(schema.codRemittances.status, "scheduled"))).for("update");
    if (!r) return null;
    await tx.delete(schema.codRemittanceItems).where(eq(schema.codRemittanceItems.remittanceId, r.id));
    await tx.update(schema.codRemittances).set({ status: "cancelled" }).where(eq(schema.codRemittances.id, r.id));
    if (r.walletOffsetPaise > 0) {
      const [w] = await tx.select().from(schema.wallets).where(eq(schema.wallets.orgId, r.orgId));
      if (w) await debit(dbLedgerStore(tx), { walletId: w.id, amount: r.walletOffsetPaise, kind: "cod_offset_reversal", allowNegative: true, idempotencyKey: `codoffset-rev:${r.id}`, refType: "cod_remittance", refId: r.id, memo: `COD payout ${r.id} cancelled` });
    }
    // the Online Store fee stays recorded on its orders (feeVia "cod") and is taken again, unchanged, by the next payout
    return r;
  });
}

const csvCell = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

/** Bank bulk-transfer file (CSV) for scheduled payouts: beneficiary, account, IFSC, amount, narration, payout id. */
export async function bankFileCsv(ids: string[]) {
  const db = await getDb();
  if (!ids.length) return { csv: "", count: 0, totalPaise: 0 };
  const rows = await db.select({ r: schema.codRemittances, a: schema.orgPayoutAccounts, name: schema.orgs.businessName }).from(schema.codRemittances)
    .innerJoin(schema.orgs, eq(schema.orgs.id, schema.codRemittances.orgId)).leftJoin(schema.orgPayoutAccounts, eq(schema.orgPayoutAccounts.orgId, schema.codRemittances.orgId))
    .where(and(inArray(schema.codRemittances.id, ids), eq(schema.codRemittances.status, "scheduled")));
  const lines = [["Beneficiary Name", "Account Number", "IFSC", "Amount", "Narration", "Payout ID", "Client"].join(",")];
  let total = 0;
  for (const { r, a, name } of rows) {
    if (!a || r.netPaise <= 0) continue;
    total += r.netPaise;
    lines.push([a.holderName, decrypt(a.accountEnc), a.ifsc, (r.netPaise / 100).toFixed(2), `Vishwaship COD ${r.id.slice(-8)}`, r.id, name].map(csvCell).join(","));
  }
  return { csv: lines.join("\r\n") + "\r\n", count: lines.length - 1, totalPaise: total };
}

/** Mark scheduled payouts paid with their bank reference (one UTR each, or one batch reference for all). */
export async function markPayoutsPaid(items: Array<{ id: string; reference: string }>) {
  const db = await getDb();
  const done: Array<typeof schema.codRemittances.$inferSelect> = [];
  for (const it of items) {
    const u = await db.update(schema.codRemittances).set({ status: "paid", reference: it.reference, paidAt: new Date() })
      .where(and(eq(schema.codRemittances.id, it.id), eq(schema.codRemittances.status, "scheduled"))).returning();
    if (u.length) {
      done.push(u[0]);
      await db.insert(schema.inAppAlerts).values({ id: newId("al"), orgId: u[0].orgId, kind: "cod", title: `COD remittance of ₹${(u[0].netPaise / 100).toFixed(2)} paid (ref ${it.reference})`, href: "/portal/billing/cod-remittance/" });
    }
  }
  return done;
}

// ---------- payout bank account ----------

export const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export function normalizeAccount(v: string) { return v.replace(/[\s-]/g, ""); }

export async function savePayoutAccount(orgId: string, a: { holderName: string; accountNumber: string; ifsc: string; bankName?: string | null }, actor: string) {
  const acct = normalizeAccount(a.accountNumber);
  if (!/^\d{9,18}$/.test(acct)) throw new Error("Account number must be 9 to 18 digits");
  const ifsc = a.ifsc.trim().toUpperCase();
  if (!IFSC.test(ifsc)) throw new Error("IFSC looks wrong (e.g. HDFC0001234)");
  const db = await getDb();
  const v = { holderName: a.holderName.trim(), accountEnc: encrypt(acct), accountLast4: acct.slice(-4), ifsc, bankName: a.bankName?.trim() || null, updatedBy: actor, updatedAt: new Date() };
  await db.insert(schema.orgPayoutAccounts).values({ orgId, ...v }).onConflictDoUpdate({ target: schema.orgPayoutAccounts.orgId, set: v });
  return { holderName: v.holderName, last4: v.accountLast4, ifsc, bankName: v.bankName };
}

export async function payoutAccount(orgId: string) {
  const db = await getDb();
  const [a] = await db.select().from(schema.orgPayoutAccounts).where(eq(schema.orgPayoutAccounts.orgId, orgId));
  return a ? { holderName: a.holderName, last4: a.accountLast4, ifsc: a.ifsc, bankName: a.bankName, updatedAt: a.updatedAt } : null;
}
