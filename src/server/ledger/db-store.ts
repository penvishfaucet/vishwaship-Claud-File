import "server-only";
import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { newId } from "@/server/util/ids";
import type { LedgerEntry, LedgerStore, WalletState } from "./wallet";

type Tx = Parameters<Parameters<Awaited<ReturnType<typeof getDb>>["transaction"]>[0]>[0];

/** Postgres-backed LedgerStore bound to a transaction. lockWallet() takes a row lock (FOR UPDATE). */
export function dbLedgerStore(tx: Tx): LedgerStore {
  let lockedWalletId = "";
  return {
    async lockWallet(walletId) {
      const r = await tx.execute(sql`select id, posted_paise, reserved_paise from ${schema.wallets} where id = ${walletId} for update`);
      const row = (r as unknown as { rows: Array<{ id: string; posted_paise: string | number; reserved_paise: string | number }> }).rows[0];
      if (!row) throw new Error("Wallet not found");
      lockedWalletId = row.id;
      return { walletId: row.id, posted: Number(row.posted_paise), reserved: Number(row.reserved_paise) };
    },
    async findByIdempotencyKey(key) {
      const [e] = await tx.select().from(schema.ledgerEntries).where(eq(schema.ledgerEntries.idempotencyKey, key));
      return e ? toEntry(e) : null;
    },
    async findOpenReservation(id) {
      const [r] = await tx.select().from(schema.reservations).where(eq(schema.reservations.id, id));
      return r ? { amount: r.amountPaise, status: r.status as "open" | "settled" | "released" } : null;
    },
    async insert(e) {
      const [row] = await tx.insert(schema.ledgerEntries).values({
        id: newId("le"), walletId: e.walletId, kind: e.kind, amountPaise: e.amount, holdDeltaPaise: e.holdDelta,
        idempotencyKey: e.idempotencyKey, reservationId: e.reservationId ?? null, refType: e.refType ?? null, refId: e.refId ?? null,
        balanceAfterPaise: e.balanceAfter, reservedAfterPaise: e.reservedAfter, memo: e.memo ?? null,
      }).returning();
      return toEntry(row);
    },
    async saveWallet(w: WalletState) {
      await tx.update(schema.wallets).set({ postedPaise: w.posted, reservedPaise: w.reserved, updatedAt: new Date() }).where(eq(schema.wallets.id, w.walletId));
    },
    async setReservationStatus(id, status, amount) {
      if (!lockedWalletId) throw new Error("setReservationStatus called before lockWallet");
      await tx.insert(schema.reservations).values({ id, walletId: lockedWalletId, amountPaise: amount, status })
        .onConflictDoUpdate({ target: schema.reservations.id, set: { status, updatedAt: new Date() } });
    },
  };
}

function toEntry(e: typeof schema.ledgerEntries.$inferSelect): LedgerEntry {
  return {
    id: e.id, walletId: e.walletId, kind: e.kind as LedgerEntry["kind"], amount: e.amountPaise, holdDelta: e.holdDeltaPaise,
    idempotencyKey: e.idempotencyKey, reservationId: e.reservationId, refType: e.refType, refId: e.refId,
    balanceAfter: e.balanceAfterPaise, reservedAfter: e.reservedAfterPaise, createdAt: e.createdAt, memo: e.memo,
  };
}

/** Run ledger operations inside one serialisable unit. */
export async function withLedger<T>(fn: (store: LedgerStore) => Promise<T>): Promise<T> {
  const db = await getDb();
  return db.transaction(async (tx) => fn(dbLedgerStore(tx)));
}
