import "server-only";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db/client";
import { enqueue } from "@/server/jobs/runner";
import { dbLedgerStore } from "@/server/ledger/db-store";
import { InsufficientBalanceError, debit } from "@/server/ledger/wallet";
import type { ApiErrorCode } from "@/server/http";
import { getSetting } from "@/server/quotes/service";
import { newId } from "@/server/util/ids";

/**
 * Notification credits bought from the shipping wallet. Admin sets the price of one credit (default ₹0.25,
 * i.e. ₹1 = 4 credits) and whether that price already includes GST. One WhatsApp message = the credits set
 * in Admin → Notifications (default 1). Credits are taken only for a message the provider accepts.
 */
export type CreditPrice = { paisePerCredit: number; gstInclusive: boolean; minRupees: number };
export const CREDIT_PRICE_DEFAULTS: CreditPrice = { paisePerCredit: 25, gstInclusive: true, minRupees: 10 };
export const creditPrice = async (): Promise<CreditPrice> => ({ ...CREDIT_PRICE_DEFAULTS, ...(await getSetting<Partial<CreditPrice>>("notification_credit_price", CREDIT_PRICE_DEFAULTS)).value });

/** What an amount buys: credits, and the taxable value / GST inside the wallet debit. */
export function quoteAmount(rupees: number, p: CreditPrice, gstBps: number) {
  const paise = Math.round(rupees * 100);
  if (p.gstInclusive) {
    const credits = Math.floor(paise / p.paisePerCredit);
    const total = credits * p.paisePerCredit;
    const base = Math.round((total * 10_000) / (10_000 + gstBps));
    return { credits, totalPaise: total, basePaise: base, gstPaise: total - base };
  }
  const credits = Math.floor(paise / p.paisePerCredit);
  const base = credits * p.paisePerCredit;
  const gst = Math.round((base * gstBps) / 10_000);
  return { credits, totalPaise: base + gst, basePaise: base, gstPaise: gst };
}

export type BuyResult = { ok: true; credits: number; totalPaise: number; replayed: boolean; resumed: number } | { ok: false; status: number; code: ApiErrorCode; message: string };

/** Atomic: wallet debit + credit-ledger entry + balance update in one transaction, keyed by the caller's idempotency key. */
export async function buyCredits(a: { orgId: string; userId: string; idem: string; credits: number; basePaise: number; gstPaise: number; refType: string; refId: string; memo: string }): Promise<BuyResult> {
  if (a.credits <= 0) return { ok: false, status: 400, code: "validation_error", message: "Choose an amount that buys at least one credit" };
  const db = await getDb();
  const [wallet] = await db.select().from(schema.wallets).where(eq(schema.wallets.orgId, a.orgId));
  if (!wallet) return { ok: false, status: 409, code: "conflict", message: "Wallet not found" };
  const key = `credits:${a.orgId}:${a.idem}`;
  try {
    const result = await db.transaction(async (tx) => {
      const r = await debit(dbLedgerStore(tx), { walletId: wallet.id, amount: a.basePaise + a.gstPaise, kind: "credits_purchase", idempotencyKey: key, refType: a.refType, refId: a.refId, memo: a.memo });
      if (r.replayed) return { replayed: true };
      await tx.insert(schema.creditEntries).values({ id: newId("ce"), orgId: a.orgId, kind: "purchase", credits: a.credits, idempotencyKey: key, refType: "ledger_entry", refId: r.entry.id, pricePaise: a.basePaise, gstPaise: a.gstPaise });
      await tx.insert(schema.creditBalances).values({ orgId: a.orgId, credits: a.credits })
        .onConflictDoUpdate({ target: schema.creditBalances.orgId, set: { credits: sql`${schema.creditBalances.credits} + ${a.credits}` } });
      return { replayed: false };
    });
    await audit({ actorUserId: a.userId, actorKind: "customer", orgId: a.orgId, action: "credits.purchase", targetType: a.refType, targetId: a.refId, details: { credits: a.credits, base: a.basePaise, gst: a.gstPaise, replayed: result.replayed } });
    const resumed = result.replayed ? 0 : await resumeCreditHeld(a.orgId);
    return { ok: true, credits: a.credits, totalPaise: a.basePaise + a.gstPaise, replayed: result.replayed, resumed };
  } catch (e) {
    if (e instanceof InsufficientBalanceError) return { ok: false, status: 402, code: "insufficient_balance", message: "Insufficient wallet balance. Recharge the wallet first." };
    throw e;
  }
}

/**
 * COD confirmations that could not go out only because the customer had no credits: once credits are bought,
 * send them now (the order is still on hold, so the buyer can still confirm or cancel). Each gets a fresh reply window.
 */
export async function resumeCreditHeld(orgId: string): Promise<number> {
  const db = await getDb();
  const held = await db.select({ c: schema.codConfirmations, m: schema.whatsappMessages }).from(schema.codConfirmations)
    .innerJoin(schema.whatsappMessages, and(eq(schema.whatsappMessages.orderId, schema.codConfirmations.orderId), eq(schema.whatsappMessages.event, "cod_confirmation")))
    .innerJoin(schema.orders, eq(schema.orders.id, schema.codConfirmations.orderId))
    .where(and(eq(schema.codConfirmations.orgId, orgId), eq(schema.codConfirmations.status, "send_failed"), eq(schema.whatsappMessages.status, "failed"),
      eq(schema.whatsappMessages.error, "Insufficient notification credits"), eq(schema.orders.status, "cod_hold"),
      gt(schema.codConfirmations.createdAt, new Date(Date.now() - 7 * 86400_000))))
    .limit(500);
  if (!held.length) return 0;
  const cfg = (await getSetting<{ expiryMinutes?: number; reminderMinutes?: number }>("cod_confirmation", {})).value;
  const expiry = Number(cfg.expiryMinutes ?? 1440), reminder = Number(cfg.reminderMinutes ?? 120);
  const now = Date.now();
  for (const { c, m } of held) {
    await db.update(schema.whatsappMessages).set({ status: "queued", error: null, creditsCharged: 0, updatedAt: new Date() }).where(and(eq(schema.whatsappMessages.id, m.id), eq(schema.whatsappMessages.status, "failed")));
    await db.update(schema.codConfirmations).set({ status: "pending", sentAt: null, reminderAt: new Date(now + reminder * 60_000), expiresAt: new Date(now + expiry * 60_000) })
      .where(and(eq(schema.codConfirmations.id, c.id), inArray(schema.codConfirmations.status, ["send_failed"])));
    await enqueue("cod.send", { orderId: c.orderId }, { dedupeKey: `cod.send:${c.orderId}:resume:${m.id}:${now}` });
  }
  await audit({ actorKind: "system", orgId, action: "cod.resumed_after_credits", details: { count: held.length } });
  return held.length;
}
