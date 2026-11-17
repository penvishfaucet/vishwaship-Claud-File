import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { apiCustomer } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db/client";
import { apiError } from "@/server/http";
import { BULK_COLUMNS, BULK_SAMPLE_ROW, parseCsv, parseXlsx, validateBulk } from "@/server/orders/bulk";
import { createOrder } from "@/server/orders/create";
import { rateLimit } from "@/server/security/rate-limit";
import { toCsv } from "@/lib/csv";

/** GET ?template=csv|xlsx — download the template. */
export async function GET(req: Request) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const fmt = new URL(req.url).searchParams.get("template");
  if (fmt === "xlsx") {
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Orders");
    ws.addRow([...BULK_COLUMNS]);
    ws.addRow(BULK_SAMPLE_ROW);
    ws.getRow(1).font = { bold: true };
    ws.columns.forEach((c) => { c.width = 16; });
    const buf = await wb.xlsx.writeBuffer();
    return new Response(buf as ArrayBuffer, { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": 'attachment; filename="vishwaship-bulk-orders-template.xlsx"' } });
  }
  return new Response(toCsv([...BULK_COLUMNS], [BULK_SAMPLE_ROW]), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": 'attachment; filename="vishwaship-bulk-orders-template.csv"' } });
}

/**
 * POST multipart: file + warehouseId + mode=preview|import.
 * preview → row-level validation only. import → re-validates on the server and creates only valid rows
 * (never trusts a client-side preview); invalid rows are reported back and skipped.
 */
export async function POST(req: Request) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const rl = await rateLimit(`bulk:${s.orgId}`, 30, 3600);
  if (!rl.ok) return apiError(429, "rate_limited", "Too many uploads. Try again later.");
  const fd = await req.formData();
  const file = fd.get("file");
  const warehouseId = String(fd.get("warehouseId") ?? "");
  const mode = fd.get("mode") === "import" ? "import" : "preview";
  if (!(file instanceof File)) return apiError(422, "validation_error", "Choose a CSV or XLSX file");
  if (file.size > 2 * 1024 * 1024) return apiError(422, "validation_error", "File is larger than 2 MB");
  const db = await getDb();
  const [wh] = await db.select().from(schema.warehouses).where(and(eq(schema.warehouses.id, warehouseId), eq(schema.warehouses.orgId, s.orgId)));
  if (!wh) return apiError(422, "validation_error", "Choose a pickup address");

  const buf = Buffer.from(await file.arrayBuffer());
  const isXlsx = buf[0] === 0x50 && buf[1] === 0x4b; // PK zip signature
  let rows: string[][];
  try { rows = isXlsx ? await parseXlsx(buf) : parseCsv(buf.toString("utf8")); }
  catch { return apiError(422, "validation_error", "Could not read the file. Save it as CSV (UTF-8) or XLSX and try again."); }

  const ids = rows.slice(1).map((r) => r[rows[0]?.findIndex((h) => h.trim().toLowerCase() === "order_id") ?? 0]?.trim()).filter(Boolean) as string[];
  const existing = ids.length ? await db.select({ n: schema.orders.orderNumber }).from(schema.orders).where(and(eq(schema.orders.orgId, s.orgId), inArray(schema.orders.orderNumber, ids))) : [];
  const v = validateBulk(rows, wh.id, new Set(existing.map((e) => e.n)));
  if (v.headerError) return apiError(422, "validation_error", v.headerError);

  if (mode === "preview") {
    return NextResponse.json({ total: v.results.length, valid: v.results.filter((r) => r.ok).length, rows: v.results.map(({ input: _i, ...r }) => r) });
  }
  let created = 0, codHeld = 0;
  const failures: Array<{ row: number; orderId: string; error: string }> = [];
  for (const r of v.results) {
    if (!r.ok || !r.input) continue;
    const c = await createOrder(s.orgId, r.input, "bulk");
    if (c.ok) { created++; if (c.codHold) codHeld++; } else failures.push({ row: r.row, orderId: r.orderId, error: c.message });
  }
  await audit({ actorUserId: s.userId, actorKind: "customer", orgId: s.orgId, action: "orders.bulk_import", details: { file: file.name, rows: v.results.length, created, skipped: v.results.length - created } });
  return NextResponse.json({ created, codHeld, skipped: v.results.length - created, failures });
}
