import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson } from "@/server/http";
import { run, storeAudit, storeGuard } from "@/server/store/api";
import { exportInventoryCsv, planInventoryImport, runInventoryImport } from "@/server/store/inventory";

/** GET → inventory CSV (opens in Excel / Google Sheets). */
export async function GET() {
  const g = await storeGuard(); if (g.err) return g.err;
  const csv = await exportInventoryCsv(g.s.orgId);
  const day = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  return new Response(`﻿${csv}`, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="inventory-${day}.csv"`, "cache-control": "private, no-store" } });
}

/** { text, apply? } → preview with per-row problems; apply = true changes the valid rows only. */
export async function POST(req: Request) {
  const g = await storeGuard(); if (g.err) return g.err;
  const p = await parseJson(req, z.object({ text: z.string().min(1).max(2_000_000), apply: z.boolean().default(false) })); if (!p.ok) return p.res;
  return run(async () => {
    if (!p.data.apply) return planInventoryImport(g.s.orgId, p.data.text);
    const r = await runInventoryImport(g.s.orgId, g.s.userId, p.data.text);
    await storeAudit(g.s, "stock.csv_import", undefined, r);
    return r;
  });
}
