/**
 * Prepaid shipping wallet: append-only ledger in integer paise.
 *
 * Balance model
 *   available = sum(credits) - sum(debits) - sum(open reservations)
 * Entry kinds
 *   recharge_credit   +  Razorpay payment captured (unique per razorpay payment id)
 *   reserve           (hold) booking in progress; not a debit yet
 *   reserve_settle    -  provider booking succeeded: converts the hold into a debit
 *   reserve_release   (hold released) confirmed booking failure
 *   adjustment_*      +/- reviewed admin adjustments (audited)
 *   weight_charge     -  validated discrepancy charge (unique per dispute)
 *   weight_reversal   +  compensating entry when a dispute is waived
 *   credits_purchase  -  notification credit pack bought from the wallet
 *   refund            +/- refunds
 *   store_plan        -  Online Store plan bought from the wallet
 *   store_deposit     -  Managed Meta Ads security deposit held (refundable, not revenue)
 *   store_deposit_refund + deposit returned to the wallet after an approved refund
 *
 * Every mutation carries an idempotency key that is unique in the table, so replays of the same
 * callback / job / request produce at most one entry. Callers must run these functions inside a
 * DB transaction that locks the wallet row (SELECT ... FOR UPDATE) to serialise concurrent debits.
 */
import type { Paise } from "@/lib/money";

export type LedgerKind =
  | "recharge_credit" | "reserve" | "reserve_settle" | "reserve_release"
  | "adjustment_credit" | "adjustment_debit" | "weight_charge" | "weight_reversal"
  | "credits_purchase" | "refund_credit" | "refund_debit"
  | "store_plan" | "store_deposit" | "store_deposit_refund"
  | "rto_charge" | "rto_credit" | "store_fee";

export interface LedgerEntry {
  id: string;
  walletId: string;
  kind: LedgerKind;
  /** Signed effect on the *posted* balance. Holds have 0 here and use holdDelta instead. */
  amount: Paise;
  /** Signed effect on the reserved amount (reserve: +x, settle/release: -x). */
  holdDelta: Paise;
  idempotencyKey: string;
  reservationId?: string | null;
  refType?: string | null;
  refId?: string | null;
  balanceAfter: Paise;
  reservedAfter: Paise;
  createdAt: Date;
  memo?: string | null;
}

export interface WalletState {
  walletId: string;
  posted: Paise;    // settled balance
  reserved: Paise;  // open holds
}

export const available = (w: WalletState): Paise => w.posted - w.reserved;

export class InsufficientBalanceError extends Error {
  constructor(public needed: Paise, public available: Paise) {
    super(`Insufficient wallet balance: need ${needed} paise, available ${available} paise`);
  }
}

export interface LedgerStore {
  /** Lock and read the wallet row. Must be called inside a transaction. */
  lockWallet(walletId: string): Promise<WalletState>;
  findByIdempotencyKey(key: string): Promise<LedgerEntry | null>;
  findOpenReservation(reservationId: string): Promise<{ amount: Paise; status: "open" | "settled" | "released" } | null>;
  insert(e: Omit<LedgerEntry, "id" | "createdAt">): Promise<LedgerEntry>;
  saveWallet(w: WalletState): Promise<void>;
  setReservationStatus(reservationId: string, status: "open" | "settled" | "released", amount: Paise): Promise<void>;
}

type Common = { walletId: string; idempotencyKey: string; refType?: string; refId?: string; memo?: string };

async function append(store: LedgerStore, w: WalletState, e: Omit<LedgerEntry, "id" | "createdAt" | "balanceAfter" | "reservedAfter" | "walletId">) {
  w.posted += e.amount;
  w.reserved += e.holdDelta;
  if (w.reserved < 0) throw new Error("Reserved balance would go negative");
  const entry = await store.insert({ ...e, walletId: w.walletId, balanceAfter: w.posted, reservedAfter: w.reserved });
  await store.saveWallet(w);
  return entry;
}

export async function credit(store: LedgerStore, a: Common & { amount: Paise; kind: "recharge_credit" | "adjustment_credit" | "weight_reversal" | "refund_credit" | "store_deposit_refund" | "rto_credit" }) {
  if (a.amount <= 0) throw new Error("Credit must be positive");
  const dup = await store.findByIdempotencyKey(a.idempotencyKey);
  if (dup) return { entry: dup, replayed: true };
  const w = await store.lockWallet(a.walletId);
  const entry = await append(store, w, { kind: a.kind, amount: a.amount, holdDelta: 0, idempotencyKey: a.idempotencyKey, refType: a.refType, refId: a.refId, memo: a.memo });
  return { entry, replayed: false };
}

export async function debit(store: LedgerStore, a: Common & { amount: Paise; kind: "adjustment_debit" | "weight_charge" | "credits_purchase" | "refund_debit" | "store_plan" | "store_deposit" | "rto_charge" | "store_fee"; allowNegative?: boolean }) {
  if (a.amount <= 0) throw new Error("Debit must be positive");
  const dup = await store.findByIdempotencyKey(a.idempotencyKey);
  if (dup) return { entry: dup, replayed: true };
  const w = await store.lockWallet(a.walletId);
  if (!a.allowNegative && available(w) < a.amount) throw new InsufficientBalanceError(a.amount, available(w));
  const entry = await append(store, w, { kind: a.kind, amount: -a.amount, holdDelta: 0, idempotencyKey: a.idempotencyKey, refType: a.refType, refId: a.refId, memo: a.memo });
  return { entry, replayed: false };
}

/** Hold funds before calling the carrier. */
export async function reserve(store: LedgerStore, a: Common & { amount: Paise; reservationId: string }) {
  const dup = await store.findByIdempotencyKey(a.idempotencyKey);
  if (dup) return { entry: dup, replayed: true };
  const w = await store.lockWallet(a.walletId);
  if (available(w) < a.amount) throw new InsufficientBalanceError(a.amount, available(w));
  const entry = await append(store, w, { kind: "reserve", amount: 0, holdDelta: a.amount, idempotencyKey: a.idempotencyKey, reservationId: a.reservationId, refType: a.refType, refId: a.refId, memo: a.memo });
  await store.setReservationStatus(a.reservationId, "open", a.amount);
  return { entry, replayed: false };
}

/** Booking confirmed by the provider: turn the hold into a debit, exactly once. */
export async function settle(store: LedgerStore, a: Common & { reservationId: string }) {
  const dup = await store.findByIdempotencyKey(a.idempotencyKey);
  if (dup) return { entry: dup, replayed: true };
  const w = await store.lockWallet(a.walletId);
  const r = await store.findOpenReservation(a.reservationId);
  if (!r) throw new Error(`Unknown reservation ${a.reservationId}`);
  if (r.status !== "open") throw new Error(`Reservation ${a.reservationId} is already ${r.status}`);
  const entry = await append(store, w, { kind: "reserve_settle", amount: -r.amount, holdDelta: -r.amount, idempotencyKey: a.idempotencyKey, reservationId: a.reservationId, refType: a.refType, refId: a.refId, memo: a.memo });
  await store.setReservationStatus(a.reservationId, "settled", r.amount);
  return { entry, replayed: false };
}

/** Booking definitively failed: release the hold. Ambiguous outcomes must NOT call this; they go to reconciliation. */
export async function release(store: LedgerStore, a: Common & { reservationId: string }) {
  const dup = await store.findByIdempotencyKey(a.idempotencyKey);
  if (dup) return { entry: dup, replayed: true };
  const w = await store.lockWallet(a.walletId);
  const r = await store.findOpenReservation(a.reservationId);
  if (!r) throw new Error(`Unknown reservation ${a.reservationId}`);
  if (r.status !== "open") throw new Error(`Reservation ${a.reservationId} is already ${r.status}`);
  const entry = await append(store, w, { kind: "reserve_release", amount: 0, holdDelta: -r.amount, idempotencyKey: a.idempotencyKey, reservationId: a.reservationId, refType: a.refType, refId: a.refId, memo: a.memo });
  await store.setReservationStatus(a.reservationId, "released", r.amount);
  return { entry, replayed: false };
}
