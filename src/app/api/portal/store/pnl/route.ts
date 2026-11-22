import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, parseJson } from "@/server/http";
import { storeAudit, storeGuard } from "@/server/store/api";
import { ORDER_COLS, orderRow, savePnlSettings, storePnl } from "@/server/store/pnl";
import { XLSX_TYPE, toXlsx } from "@/server/xlsx";

const D = /^\d{4}-\d{2}-\d{2}$/;

/** GET ?from=&to=&format=csv|xlsx → order-wise profit with the summary (same totals as the page). */
export async function GET(req: Request) {
  const g = await storeGuard(); if (g.err) return g.err;
  const u = new URL(req.url);
  const from = u.searchParams.get("from") ?? "", to = u.searchParams.get("to") ?? "";
  if (!D.test(from) || !D.test(to) || from > to) return apiError(422, "validation_error", "Choose a valid date range");
  const p = await storePnl(g.s.orgId, { from, to });
  const s = p.summary, rs = (x: number) => Math.round(x) / 100;
  const summary: unknown[][] = [[], ["Summary", `${from} to ${to}`], ["Net sales (ex-GST)", rs(s.netSales)], ["Shipping collected", rs(s.shippingCollected)], ["Product cost", rs(s.productCost)],
    ["Shipping paid", rs(s.shippingPaid)], ["Payment fees", rs(s.paymentFees)], ["Order expenses", rs(s.orderExpenses)], ["Order contribution", rs(s.contribution)],
    ...p.overhead.map((o) => [o.label, rs(o.amount)]), ["Store-level expenses", rs(s.overhead)], ["Net profit", rs(s.net)], ["Margin %", s.marginPct ?? ""],
    ["Output GST", rs(p.gst.output)], ["Input GST (claimable)", rs(p.gst.inputRecoverable)], ["GST not claimable", rs(p.gst.nonRecoverable)],
    ["Pending (not delivered yet)", `${s.pending.count} orders, ${rs(s.pending.valuePaise)}`]];
  const rows = [...p.orders.map(orderRow), ...summary];
  const name = `store-pnl-${from}-to-${to}`;
  if (u.searchParams.get("format") === "xlsx") {
    const buf = await toXlsx("Store P&L", ORDER_COLS, rows);
    return new Response(buf, { headers: { "content-type": XLSX_TYPE, "content-disposition": `attachment; filename="${name}.xlsx"`, "cache-control": "private, no-store" } });
  }
  const cell = (v: unknown) => { const t = String(v ?? ""); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const csv = [ORDER_COLS, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
  return new Response(`﻿${csv}`, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}.csv"`, "cache-control": "private, no-store" } });
}

/** P&L settings: GST registered, estimated payment-gateway fee (basis points). */
export async function POST(req: Request) {
  const g = await storeGuard(); if (g.err) return g.err;
  const p = await parseJson(req, z.object({ gstRegistered: z.boolean(), gatewayFeeBps: z.number().int().min(0).max(1000) })); if (!p.ok) return p.res;
  await savePnlSettings(g.s.orgId, g.s.userId, p.data);
  await storeAudit(g.s, "pnl.settings", undefined, p.data);
  return NextResponse.json({ ok: true });
}
