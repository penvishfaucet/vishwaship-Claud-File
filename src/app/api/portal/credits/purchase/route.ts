import { NextResponse } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { apiCustomer } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db/client";
import { apiError, parseJson } from "@/server/http";
import { dbLedgerStore } from "@/server/ledger/db-store";
import { InsufficientBalanceError, debit } from "@/server/ledger/wallet";
import { newId } from "@/server/util/ids";

/** Atomic: wallet debit + credit-ledger entry + balance update in ONE transaction, keyed by Idempotency-Key. */
export async function POST(req: Request) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const idem = req.headers.get("idempotency-key");
  if (!idem || idem.length > 100) return apiError(400, "validation_error", "Idempotency-Key header is required");
  const p = await parseJson(req, z.object({ packId: z.string() }));
  if (!p.ok) return p.res;
  const db = await getDb();
  const [pack] = await db.select().from(schema.creditPacks).where(and(eq(schema.creditPacks.id, p.data.packId), eq(schema.creditPacks.active, true)));
  if (!pack) return apiError(404, "not_found", "Credit pack not found");
  const [g] = await db.select().from(schema.pricingSettings).where(eq(schema.pricingSettings.key, "gst_bps"));
  const base = pack.credits * pack.unitPricePaise;
  const gst = Math.round((base * Number(g?.value ?? 1800)) / 10_000);
  const key = `credits:${s.orgId}:${idem}`;
  const [wallet] = await db.select().from(schema.wallets).where(eq(schema.wallets.orgId, s.orgId));
  try {
    const result = await db.transaction(async (tx) => {
      const r = await debit(dbLedgerStore(tx), { walletId: wallet.id, amount: base + gst, kind: "credits_purchase", idempotencyKey: key, refType: "credit_pack", refId: pack.id, memo: `${pack.credits} notification credits` });
      if (r.replayed) return { replayed: true };
      await tx.insert(schema.creditEntries).values({ id: newId("ce"), orgId: s.orgId, kind: "purchase", credits: pack.credits, idempotencyKey: key, refType: "ledger_entry", refId: r.entry.id, pricePaise: base, gstPaise: gst });
      await tx.insert(schema.creditBalances).values({ orgId: s.orgId, credits: pack.credits })
        .onConflictDoUpdate({ target: schema.creditBalances.orgId, set: { credits: sql`${schema.creditBalances.credits} + ${pack.credits}` } });
      return { replayed: false };
    });
    await audit({ actorUserId: s.userId, actorKind: "customer", orgId: s.orgId, action: "credits.purchase", targetType: "credit_pack", targetId: pack.id, details: { base, gst, replayed: result.replayed } });
    return NextResponse.json({ ok: true, credits: pack.credits, totalPaise: base + gst, replayed: result.replayed });
  } catch (e) {
    if (e instanceof InsufficientBalanceError) return apiError(402, "insufficient_balance", "Insufficient wallet balance. Recharge to buy credits.");
    throw e;
  }
}
