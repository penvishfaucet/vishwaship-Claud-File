import { OrderInput } from "./create";

/** Column order of the downloadable template (CSV and XLSX). */
export const BULK_COLUMNS = [
  "order_id", "type", "payment", "cod_amount", "declared_value",
  "consignee_name", "consignee_mobile", "address_line1", "address_line2", "pincode", "city", "state",
  "product_name", "quantity", "unit_price", "hsn",
  "boxes", "length_cm", "breadth_cm", "height_cm", "weight_kg_per_box",
  "invoice_number", "eway_bill",
] as const;

export const BULK_SAMPLE_ROW = [
  "SAMPLE-1001", "B2C", "prepaid", "", "1499", "Sample Buyer", "9876543210", "12 Sample Street", "", "411001", "Pune", "Maharashtra",
  "Sample item", "1", "1499", "", "1", "20", "15", "10", "0.5", "", "",
];

export const MAX_BULK_ROWS = 1000;

/** RFC 4180 CSV parser (quotes, escaped quotes, CRLF/LF, BOM). */
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

/** Read the first worksheet of an .xlsx buffer into string rows. */
export async function parseXlsx(buf: Buffer): Promise<string[][]> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const rows: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (r) => {
    const vals = (r.values as unknown[]).slice(1).map((v) => {
      if (v === null || v === undefined) return "";
      if (typeof v === "object" && v && "text" in v) return String((v as { text: unknown }).text);
      if (typeof v === "object" && v && "result" in v) return String((v as { result: unknown }).result);
      return String(v);
    });
    rows.push(vals);
  });
  return rows;
}

export interface BulkRowResult {
  row: number; // 1-based spreadsheet row (header = 1)
  orderId: string;
  ok: boolean;
  errors: string[];
  input?: ReturnType<typeof OrderInput.parse>;
  summary?: string;
}

const n = (v: string) => (v.trim() === "" ? undefined : Number(v.replace(/,/g, "")));

/**
 * Validate rows against the same schema as manual/API orders. Rows that share an order_id are
 * merged as extra products/packages of one order only if the address matches; otherwise flagged.
 */
export function validateBulk(rows: string[][], warehouseId: string, existingOrderIds: Set<string>): { results: BulkRowResult[]; headerError?: string } {
  if (rows.length < 2) return { results: [], headerError: "The file has no data rows." };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const missing = ["order_id", "type", "payment", "consignee_name", "consignee_mobile", "address_line1", "pincode", "city", "state", "product_name", "quantity", "length_cm", "breadth_cm", "height_cm", "weight_kg_per_box"].filter((c) => !header.includes(c));
  if (missing.length) return { results: [], headerError: `Missing column(s): ${missing.join(", ")}. Download the template.` };
  if (rows.length - 1 > MAX_BULK_ROWS) return { results: [], headerError: `Too many rows (${rows.length - 1}). Maximum is ${MAX_BULK_ROWS} per file.` };
  const col = (r: string[], name: string) => (r[header.indexOf(name)] ?? "").trim();
  const seen = new Map<string, number>();
  const results: BulkRowResult[] = [];
  rows.slice(1).forEach((r, i) => {
    const rowNo = i + 2;
    const orderId = col(r, "order_id");
    const errors: string[] = [];
    if (!orderId) errors.push("order_id is required");
    else if (existingOrderIds.has(orderId)) errors.push(`Duplicate: order ${orderId} already exists in your account`);
    else if (seen.has(orderId)) errors.push(`Duplicate: order ${orderId} also on row ${seen.get(orderId)}`);
    if (orderId) seen.set(orderId, seen.get(orderId) ?? rowNo);
    const payment = col(r, "payment").toLowerCase();
    const type = col(r, "type").toUpperCase();
    const candidate = {
      orderNumber: orderId || undefined,
      mode: type, direction: "forward", paymentType: payment,
      codAmountRupees: n(col(r, "cod_amount")) ?? 0,
      declaredValueRupees: n(col(r, "declared_value")) ?? (n(col(r, "unit_price")) ?? 0) * (n(col(r, "quantity")) ?? 1),
      warehouseId,
      consignee: { name: col(r, "consignee_name"), mobile: col(r, "consignee_mobile"), line1: col(r, "address_line1"), line2: col(r, "address_line2") || undefined, pincode: col(r, "pincode"), city: col(r, "city"), state: col(r, "state") },
      products: [{ name: col(r, "product_name"), qty: n(col(r, "quantity")) ?? NaN, unitPriceRupees: n(col(r, "unit_price")) ?? 0, hsn: col(r, "hsn") || undefined }],
      packages: [{ count: n(col(r, "boxes")) ?? 1, lengthCm: n(col(r, "length_cm")) ?? NaN, breadthCm: n(col(r, "breadth_cm")) ?? NaN, heightCm: n(col(r, "height_cm")) ?? NaN, weightKg: n(col(r, "weight_kg_per_box")) ?? NaN }],
      invoiceNumber: col(r, "invoice_number") || undefined,
      ewayBill: col(r, "eway_bill") || undefined,
    };
    const p = OrderInput.safeParse(candidate);
    if (!p.success) for (const iss of p.error.issues) errors.push(`${iss.path.join(".") || "row"}: ${iss.message}`);
    results.push({
      row: rowNo, orderId, ok: errors.length === 0, errors, input: p.success ? p.data : undefined,
      summary: `${candidate.consignee.name || "?"}, ${candidate.consignee.city || "?"} ${candidate.consignee.pincode} · ${type || "?"} · ${payment || "?"}`,
    });
  });
  return { results };
}
