import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, parseJson } from "@/server/http";
import { RTO_COLS, rtoReport, rtoRow } from "@/server/rto/charges";
import { run, storeAudit, storeGuard } from "@/server/store/api";
import { COD_COLS, codRow, codSettlements, codShipments, compareCodFile, raiseCodDispute } from "@/server/store/cod";
import { XLSX_TYPE, toXlsx } from "@/server/xlsx";

const D = /^\d{4}-\d{2}-\d{2}$/;
const cell = (v: unknown) => { const t = String(v ?? ""); return /[",\n]/.test(t) || /^[=+@]/.test(t) ? `"${(/^[=+@]/.test(t) ? `'${t}` : t).replace(/"/g, '""')}"` : t; };

/** GET ?kind=rto|cod|settlements&format=csv|xlsx&from&to&courier&awb&state&all=1 → download (store orders only unless all=1). */
export async function GET(req: Request) {
  const g = await storeGuard(); if (g.err) return g.err;
  const u = new URL(req.url), sp = (k: string) => u.searchParams.get(k) ?? undefined;
  const from = sp("from"), to = sp("to");
  if ((from && !D.test(from)) || (to && !D.test(to))) return apiError(422, "validation_error", "Choose valid dates");
  const storeOnly = sp("all") !== "1";
  let cols: string[], rows: unknown[][], name: string;
  if (sp("kind") === "cod") {
    const r = await codShipments(g.s.orgId, { from, to, state: sp("state"), q: sp("awb"), storeOnly });
    cols = COD_COLS; rows = r.map(codRow); name = "cod-awb-wise";
  } else if (sp("kind") === "settlements") {
    const b = await codSettlements(g.s.orgId, storeOnly);
    cols = ["Settlement", "Status", "Cycle date", "Paid on", "UTR", "Gross", "Deductions", "Deduction note", "Net", "AWB", "Order", "COD amount"];
    const day = (x: Date | null) => (x ? new Date(x.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10) : "");
    rows = b.flatMap((s) => s.awbs.map((a) => [s.id, s.status, day(s.cycleDate), day(s.paidAt), s.utr ?? "", s.grossPaise / 100, s.deductionsPaise / 100, s.deductionNote ?? "", s.netPaise / 100, a.awb ?? "", a.order, a.codPaise / 100]));
    name = "cod-settlements";
  } else {
    const r = await rtoReport(g.s.orgId, { from, to, courier: sp("courier"), awb: sp("awb"), state: sp("state"), storeOnly });
    cols = RTO_COLS; rows = r.map(rtoRow); name = "rto-order-wise";
  }
  const stamp = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
  if (sp("format") === "xlsx") return new Response(await toXlsx(name, cols, rows), { headers: { "content-type": XLSX_TYPE, "content-disposition": `attachment; filename="${name}-${stamp}.xlsx"`, "cache-control": "private, no-store" } });
  return new Response(`﻿${[cols, ...rows].map((r) => r.map(cell).join(",")).join("\r\n")}`, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}-${stamp}.csv"`, "cache-control": "private, no-store" } });
}

/** compare → check a payout / bank file against our COD records (changes nothing). dispute → ask about one shipment's COD. */
export async function POST(req: Request) {
  const g = await storeGuard(); if (g.err) return g.err;
  const p = await parseJson(req, z.discriminatedUnion("action", [
    z.object({ action: z.literal("compare"), text: z.string().min(1).max(2_000_000) }),
    z.object({ action: z.literal("dispute"), shipmentId: z.string().max(64), note: z.string().max(500) }),
  ])); if (!p.ok) return p.res;
  const d = p.data;
  return run(async () => {
    if (d.action === "compare") return compareCodFile(g.s.orgId, d.text);
    const r = await raiseCodDispute(g.s.orgId, g.s.userId, d.shipmentId, d.note);
    await storeAudit(g.s, "cod.dispute", d.shipmentId, { note: d.note });
    return NextResponse.json({ ok: true, ...r });
  });
}
