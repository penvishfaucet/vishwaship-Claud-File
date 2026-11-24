import { NextResponse } from "next/server";
import { audit } from "@/server/audit";
import { apiStaff } from "@/server/auth/session";
import { codRowsFromGrid, codRowsFromMail, importCodReceipts } from "@/server/cod/receipts";
import { apiError } from "@/server/http";
import { parseCsv, parseXlsx } from "@/server/orders/bulk";

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Courier COD remittance: upload the courier's file (Shipmozo panel export, Delhivery attachment: .xlsx / .csv) or paste
 * the remittance e-mail. Preview first (commit = "false" writes nothing), then record it.
 */
export async function POST(req: Request) {
  const s = await apiStaff("cod.remit");
  if (!s) return apiError(403, "forbidden", "You cannot record courier COD");
  let form: FormData;
  try { form = await req.formData(); } catch { return apiError(400, "validation_error", "Send the file as a form upload"); }
  const commit = form.get("commit") === "true";
  const file = form.get("file");
  const pasted = String(form.get("text") ?? "").trim();
  let rows; let fileName: string | null = null; let source: "courier_file" | "delhivery_mail" = "courier_file";
  if (file instanceof File && file.size) {
    if (file.size > MAX_BYTES) return apiError(413, "validation_error", "File is larger than 5 MB");
    fileName = file.name.slice(0, 200);
    const buf = Buffer.from(await file.arrayBuffer());
    const isXlsx = buf[0] === 0x50 && buf[1] === 0x4b; // zip
    let grid: string[][];
    try { grid = isXlsx ? await parseXlsx(buf) : parseCsv(buf.toString("utf8").replace(/^\uFEFF/, "")); }
    catch { return apiError(400, "validation_error", "Could not read the file. Upload the courier's .xlsx or .csv as downloaded."); }
    const r = codRowsFromGrid(grid);
    if (r.error) return apiError(400, "validation_error", r.error);
    rows = r.rows;
  } else if (pasted) {
    source = "delhivery_mail";
    rows = codRowsFromMail(String(form.get("subject") ?? "COD remittance"), pasted.slice(0, 500_000));
    if (!rows.length) return apiError(400, "validation_error", "No AWB with a COD amount found in the pasted text");
  } else return apiError(400, "validation_error", "Choose the courier's file or paste the remittance e-mail");
  if (!rows.length) return apiError(400, "validation_error", "The file has no AWB rows");
  const r = await importCodReceipts(rows, { source, fileName, actorUserId: s.userId, commit });
  if (commit) await audit({ actorUserId: s.userId, actorKind: "staff", action: "admin.cod_receipts_import", targetType: "cod_receipt_import", targetId: r.importId ?? undefined, details: { fileName, rows: rows.length, matched: r.matched, flagged: r.flagged, totalPaise: r.totalPaise } });
  return NextResponse.json(r);
}
