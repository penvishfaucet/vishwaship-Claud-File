import { describe, expect, it } from "vitest";
import { MemoryLedgerStore } from "./memory-store";
import { InsufficientBalanceError, available, credit, release, reserve, settle } from "./wallet";

const W = "w1";

describe("wallet ledger", () => {
  it("credits a recharge once even when the webhook is replayed", async () => {
    const s = new MemoryLedgerStore([{ walletId: W }]);
    const a = await credit(s, { walletId: W, amount: 50_000, kind: "recharge_credit", idempotencyKey: "rzp:pay_123" });
    const b = await credit(s, { walletId: W, amount: 50_000, kind: "recharge_credit", idempotencyKey: "rzp:pay_123" });
    expect(a.replayed).toBe(false);
    expect(b.replayed).toBe(true);
    expect(s.wallets.get(W)!.posted).toBe(50_000);
    expect(s.entries).toHaveLength(1);
  });

  it("reserves, then settles exactly once", async () => {
    const s = new MemoryLedgerStore([{ walletId: W, posted: 20_000 }]);
    await reserve(s, { walletId: W, amount: 14_750, reservationId: "r1", idempotencyKey: "res:r1" });
    expect(available(s.wallets.get(W)!)).toBe(5_250);
    await settle(s, { walletId: W, reservationId: "r1", idempotencyKey: "settle:r1" });
    await settle(s, { walletId: W, reservationId: "r1", idempotencyKey: "settle:r1" }); // replay
    const w = s.wallets.get(W)!;
    expect(w.posted).toBe(5_250);
    expect(w.reserved).toBe(0);
  });

  it("releases a hold on confirmed failure without debiting", async () => {
    const s = new MemoryLedgerStore([{ walletId: W, posted: 20_000 }]);
    await reserve(s, { walletId: W, amount: 14_750, reservationId: "r2", idempotencyKey: "res:r2" });
    await release(s, { walletId: W, reservationId: "r2", idempotencyKey: "rel:r2" });
    expect(s.wallets.get(W)).toMatchObject({ posted: 20_000, reserved: 0 });
    await expect(settle(s, { walletId: W, reservationId: "r2", idempotencyKey: "settle:r2" })).rejects.toThrow(/released/);
  });

  it("refuses a reservation larger than the available balance", async () => {
    const s = new MemoryLedgerStore([{ walletId: W, posted: 10_000 }]);
    await reserve(s, { walletId: W, amount: 8_000, reservationId: "a", idempotencyKey: "res:a" });
    await expect(reserve(s, { walletId: W, amount: 8_000, reservationId: "b", idempotencyKey: "res:b" }))
      .rejects.toBeInstanceOf(InsufficientBalanceError);
  });
});
