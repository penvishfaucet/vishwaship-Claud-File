import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { apiCustomer } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { apiError, parseJson } from "@/server/http";
import { buyCredits, creditPrice, quoteAmount } from "@/server/notifications/credits";

/**
 * Buy notification credits from the shipping wallet: any amount (₹ → credits at the Admin price, default ₹0.25 each)
 * or a fixed pack. Atomic and keyed by the Idempotency-Key header.
 */
export async function POST(req: Request) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const idem = req.headers.get("idempotency-key");
  if (!idem || idem.length > 100) return apiError(400, "validation_error", "Idempotency-Key header is required");
  const p = await parseJson(req, z.union([z.object({ packId: z.string().min(1).max(64) }), z.object({ amountRupees: z.number().positive().max(1_00_000) })]));
  if (!p.ok) return p.res;
  const db = await getDb();
  const [g] = await db.select().from(schema.pricingSettings).where(eq(schema.pricingSettings.key, "gst_bps"));
  const gstBps = Number(g?.value ?? 1800);
  let r;
  if ("packId" in p.data) {
    const [pack] = await db.select().from(schema.creditPacks).where(and(eq(schema.creditPacks.id, p.data.packId), eq(schema.creditPacks.active, true)));
    if (!pack) return apiError(404, "not_found", "Credit pack not found");
    const base = pack.credits * pack.unitPricePaise;
    r = await buyCredits({ orgId: s.orgId, userId: s.userId, idem, credits: pack.credits, basePaise: base, gstPaise: Math.round((base * gstBps) / 10_000), refType: "credit_pack", refId: pack.id, memo: `${pack.credits} notification credits` });
  } else {
    const price = await creditPrice();
    if (p.data.amountRupees < price.minRupees) return apiError(400, "validation_error", `Minimum ₹${price.minRupees}`);
    const q = quoteAmount(p.data.amountRupees, price, gstBps);
    r = await buyCredits({ orgId: s.orgId, userId: s.userId, idem, credits: q.credits, basePaise: q.basePaise, gstPaise: q.gstPaise, refType: "credit_amount", refId: `amt_${q.totalPaise}`, memo: `${q.credits} notification credits (₹${(price.paisePerCredit / 100).toFixed(2)} each)` });
  }
  if (!r.ok) return apiError(r.status, r.code, r.message);
  return NextResponse.json({ ok: true, credits: r.credits, totalPaise: r.totalPaise, replayed: r.replayed, resumed: r.resumed });
}
