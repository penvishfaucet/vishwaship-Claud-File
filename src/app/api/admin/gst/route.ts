import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/server/audit";
import { apiStaff } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { apiError, parseJson } from "@/server/http";
import { istFrom, istTo } from "@/lib/gst";
import { newKey, putPrivate, sniffUpload } from "@/server/storage";
import { XLSX_TYPE } from "@/server/xlsx";
import { IMPORT_COLUMNS, IMPORT_SAMPLE, addCourierBill, importCourierRows, recordCourierPayment, rematch, resolveLine } from "@/server/gst/courier";
import { exportOutward, exportPurchases, exportRecon } from "@/server/gst/admin";

export const dynamic = "force-dynamic";

/**
 * Admin → Finance & GST. Reading courier costs needs shipments.cost.read; recording bills / payments also needs
 * finance.adjust. The outward-supply export needs finance.read. Every write is audited.
 */
const rupees = z.coerce.number().min(0).max(1e9).transform((n) => Math.round(n * 100));
const Body = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("bill_add"), kind: z.enum(["invoice", "credit_note", "debit_note"]), supplierName: z.string().trim().min(2).max(80),
    supplierGstin: z.string().trim().max(15).default(""), billedGstin: z.string().trim().max(15).default(""), number: z.string().trim().min(1).max(60),
    docDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), originalNumber: z.string().trim().max(60).default(""), placeOfSupply: z.string().trim().max(2).default(""),
    taxable: rupees, cgst: rupees.default(0), sgst: rupees.default(0), utgst: rupees.default(0), igst: rupees.default(0),
    awb: z.string().trim().max(40).default(""), chargeType: z.string().trim().max(20).default("forward"), notes: z.string().trim().max(300).default(""),
  }),
  z.object({
    op: z.literal("payment_add"), supplierName: z.string().trim().min(2).max(80), amount: rupees, paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reference: z.string().trim().min(2).max(80), method: z.string().trim().max(40).default(""), billNumber: z.string().trim().max(60).default(""), allocate: rupees.default(0), notes: z.string().trim().max(300).default(""),
  }),
  z.object({ op: z.literal("rematch") }),
  z.object({ op: z.literal("resolve"), lineId: z.string().min(3).max(60), note: z.string().trim().min(3).max(300) }),
  z.object({ op: z.literal("itc_status"), billId: z.string().min(3).max(60), status: z.enum(["pending_review", "eligible", "ineligible", "blocked"]) }),
]);

/** Courier purchase data: cost permission to read; plus finance.adjust to change anything. */
async function staffFor(write: boolean) {
  const s = await apiStaff("shipments.cost.read");
  if (!s) return null;
  if (write && !(await apiStaff("finance.adjust"))) return null;
  return s;
}

export async function POST(req: Request) {
  // multipart: courier bill import (CSV / XLSX) or the original PDF of a bill
  if ((req.headers.get("content-type") ?? "").startsWith("multipart/form-data")) {
    const s = await staffFor(true);
    if (!s) return apiError(403, "forbidden", "You don't have permission to record courier bills");
    const fd = await req.formData();
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) return apiError(422, "validation_error", "Choose a file");
    if (file.size > 10 * 1024 * 1024) return apiError(422, "validation_error", "File is larger than 10 MB");
    const buf = Buffer.from(await file.arrayBuffer());
    if (fd.get("mode") === "pdf") {
      const billId = String(fd.get("billId") ?? "");
      const db = await getDb();
      const [b] = await db.select({ id: schema.courierBills.id, number: schema.courierBills.number }).from(schema.courierBills).where(eq(schema.courierBills.id, billId));
      if (!b) return apiError(404, "not_found", "Bill not found");
      const kind = sniffUpload(buf);
      if (!kind) return apiError(422, "validation_error", "Upload a PDF, PNG or JPG of up to 5 MB");
      const key = newKey("courier-bills", kind.ext);
      await putPrivate(key, buf);
      await db.update(schema.courierBills).set({ fileKey: key }).where(eq(schema.courierBills.id, b.id));
      await audit({ actorUserId: s.userId, actorKind: "staff", action: "gst.courier_bill_file", targetType: "courier_bill", targetId: b.id, details: { number: b.number } });
      return NextResponse.json({ ok: true, message: `Original attached to ${b.number}` });
    }
    const { parseCsv, parseXlsx } = await import("@/server/orders/bulk");
    const isXlsx = buf[0] === 0x50 && buf[1] === 0x4b; // .xlsx is a zip
    const rows = isXlsx ? await parseXlsx(buf) : parseCsv(buf.toString("utf8"));
    const r = await importCourierRows(rows, s.userId);
    await audit({ actorUserId: s.userId, actorKind: "staff", action: "gst.courier_import", details: { file: file.name.slice(0, 80), created: r.created, duplicates: r.duplicates.length, errors: r.errors.length } });
    const parts = [`${r.created} document(s) imported`, `${r.matched} AWB line(s) matched`, r.unmatched ? `${r.unmatched} unmatched (see Unmatched)` : "", r.duplicates.length ? `${r.duplicates.length} duplicate(s) skipped` : ""].filter(Boolean);
    const message = parts.join(" · ") + (r.errors.length ? ` · Problems: ${r.errors.slice(0, 5).join("; ")}` : "");
    if (r.errors.length && !r.created) return apiError(422, "validation_error", message);
    return NextResponse.json({ ok: true, message, result: r });
  }

  const p = await parseJson(req, Body);
  if (!p.ok) return p.res;
  const b = p.data;
  const s = await staffFor(true);
  if (!s) return apiError(403, "forbidden", "You don't have permission to change courier purchase records");
  let message = "";
  if (b.op === "bill_add") {
    const r = await addCourierBill({
      kind: b.kind, supplierName: b.supplierName, supplierGstin: b.supplierGstin, billedGstin: b.billedGstin, number: b.number, docDate: b.docDate, originalNumber: b.originalNumber,
      placeOfSupply: b.placeOfSupply, taxablePaise: b.taxable, cgstPaise: b.cgst, sgstPaise: b.sgst, utgstPaise: b.utgst, igstPaise: b.igst, notes: b.notes,
      lines: b.awb ? [{ awb: b.awb, chargeType: b.chargeType, taxablePaise: b.taxable, gstPaise: b.cgst + b.sgst + b.utgst + b.igst }] : [],
    }, s.userId);
    if (!r.ok) return apiError(r.duplicate ? 409 : 422, r.duplicate ? "conflict" : "validation_error", r.message);
    message = `Recorded ${b.number}${b.awb ? (r.matched ? " · AWB matched" : " · AWB not found (see Unmatched)") : ""}`;
  } else if (b.op === "payment_add") {
    const r = await recordCourierPayment({ supplierName: b.supplierName, amountPaise: b.amount, paidAt: b.paidAt, reference: b.reference, method: b.method, notes: b.notes, allocations: b.billNumber && b.allocate ? [{ billNumber: b.billNumber, amountPaise: b.allocate }] : [] }, s.userId);
    if (!r.ok) { const dup = "duplicate" in r && !!r.duplicate; return apiError(dup ? 409 : 422, dup ? "conflict" : "validation_error", r.message); }
    message = `Payment ${b.reference} recorded${r.unallocatedPaise ? ` · ₹${(r.unallocatedPaise / 100).toFixed(2)} not allocated to a bill` : ""}`;
  } else if (b.op === "rematch") {
    message = `${await rematch()} line(s) matched to shipments`;
  } else if (b.op === "resolve") {
    await resolveLine(b.lineId, b.note); message = "Line marked reviewed";
  } else {
    const db = await getDb();
    await db.update(schema.courierBills).set({ itcStatus: b.status }).where(eq(schema.courierBills.id, b.billId)); message = "ITC review status saved";
  }
  await audit({ actorUserId: s.userId, actorKind: "staff", action: `gst.${b.op}`, details: { ...b } as Record<string, unknown> });
  return NextResponse.json({ ok: true, message });
}

/** GET ?export=outward|purchases|recon&from=&to= (xlsx) · ?template=csv */
export async function GET(req: Request) {
  const u = new URL(req.url);
  if (u.searchParams.get("template")) {
    if (!(await staffFor(false))) return apiError(403, "forbidden", "Not allowed");
    const csv = [IMPORT_COLUMNS.join(","), IMPORT_SAMPLE.join(",")].join("\r\n");
    return new Response(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=courier-bill-import-template.csv" } });
  }
  const kind = u.searchParams.get("export");
  const fromS = u.searchParams.get("from") ?? "", toS = u.searchParams.get("to") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromS) || !/^\d{4}-\d{2}-\d{2}$/.test(toS)) return apiError(422, "validation_error", "Choose a period");
  const from = istFrom(fromS), to = istTo(toS);
  const s = kind === "outward" ? await apiStaff("finance.read") : await staffFor(false);
  if (!s) return apiError(403, "forbidden", "Not allowed");
  const buf = kind === "outward" ? await exportOutward(from, to) : kind === "purchases" ? await exportPurchases(from, to) : kind === "recon" ? await exportRecon(from, to) : null;
  if (!buf) return apiError(422, "validation_error", "Unknown export");
  await audit({ actorUserId: s.userId, actorKind: "staff", action: "gst.export", details: { kind, from: fromS, to: toS } });
  return new Response(new Uint8Array(buf), { headers: { "content-type": XLSX_TYPE, "content-disposition": `attachment; filename=vishwaship-${kind}-${fromS}-${toS}.xlsx`, "cache-control": "no-store" } });
}
