import type { Paise } from "@/lib/money";
import type { LedgerEntry, LedgerStore, WalletState } from "./wallet";

/** In-memory LedgerStore for unit tests. Serialises callers with a promise-chain mutex per wallet. */
export class MemoryLedgerStore implements LedgerStore {
  wallets = new Map<string, WalletState>();
  entries: LedgerEntry[] = [];
  reservations = new Map<string, { amount: Paise; status: "open" | "settled" | "released" }>();
  private seq = 0;

  constructor(initial: Array<{ walletId: string; posted?: Paise }>) {
    for (const w of initial) this.wallets.set(w.walletId, { walletId: w.walletId, posted: w.posted ?? 0, reserved: 0 });
  }
  async lockWallet(walletId: string) {
    const w = this.wallets.get(walletId);
    if (!w) throw new Error("no wallet");
    return { ...w };
  }
  async findByIdempotencyKey(key: string) {
    return this.entries.find((e) => e.idempotencyKey === key) ?? null;
  }
  async findOpenReservation(id: string) {
    return this.reservations.get(id) ?? null;
  }
  async insert(e: Omit<LedgerEntry, "id" | "createdAt">) {
    if (this.entries.some((x) => x.idempotencyKey === e.idempotencyKey)) throw new Error("unique violation");
    const entry = { ...e, id: `le_${++this.seq}`, createdAt: new Date() };
    this.entries.push(entry);
    return entry;
  }
  async saveWallet(w: WalletState) {
    this.wallets.set(w.walletId, { ...w });
  }
  async setReservationStatus(id: string, status: "open" | "settled" | "released", amount: Paise) {
    this.reservations.set(id, { amount, status });
  }
}
