import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson } from "@/server/http";
import { run, storeAudit, storeGuard } from "@/server/store/api";
import { AdjustInput, MOVE_LABEL, adjustStock, stockHistory, updateItem } from "@/server/store/inventory";

/** GET ?productId=&variantId= → stock history of one item. */
export async function GET(req: Request) {
  const g = await storeGuard(); if (g.err) return g.err;
  const u = new URL(req.url);
  const productId = u.searchParams.get("productId") ?? "", variantId = u.searchParams.get("variantId") || null;
  const rows = await stockHistory(g.s.orgId, productId, variantId);
  return NextResponse.json({ moves: rows.map((m) => ({ ...m, label: MOVE_LABEL[m.kind] ?? m.kind })) });
}

/**
 * { action: "adjust", ...AdjustInput }                         receive / count / damage / write off / repair
 * { action: "item", productId, variantId, unitCostPaise?, reorderAt? }   unit cost (forward only) and reorder level
 */
export async function POST(req: Request) {
  const g = await storeGuard(); if (g.err) return g.err;
  const p = await parseJson(req, z.discriminatedUnion("action", [
    AdjustInput.extend({ action: z.literal("adjust") }),
    z.object({ action: z.literal("item"), productId: z.string().max(60), variantId: z.string().max(60).nullable().default(null),
      unitCostPaise: z.number().int().min(0).max(100_000_000).nullable().optional(), reorderAt: z.number().int().min(0).max(100_000).optional() }),
  ])); if (!p.ok) return p.res;
  const d = p.data;
  return run(async () => {
    if (d.action === "adjust") {
      const r = await adjustStock(g.s.orgId, g.s.userId, d);
      await storeAudit(g.s, `stock.${d.kind}`, d.variantId ?? d.productId, { qty: d.qty, reason: d.reason, delta: r.delta });
      return r;
    }
    await updateItem(g.s.orgId, d);
    await storeAudit(g.s, "stock.item", d.variantId ?? d.productId, { unitCostPaise: d.unitCostPaise, reorderAt: d.reorderAt });
    return { ok: true };
  });
}
