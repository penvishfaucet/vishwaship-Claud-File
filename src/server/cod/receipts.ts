import "server-only";
import { eq, inArray, or } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { newId } from "@/server/util/ids";

/**
 * COD the couriers have paid to Vishwaship, per AWB (owner 2026-11-24).
 *   Delhivery  sends a COD remittance e-mail (read automatically, like weight-discrepancy mails)
 *   Shipmozo   has no remittance API: its panel's COD remittance export (Excel / CSV) is uploaded in Admin → COD Remittance
 * Each AWB is matched to its shipment and compared with the order's COD amount. Only COD paid in full ("matched"), or a
 * different amount staff accepted, is paid on to the client (see payouts.ts); everything else waits in "Check" for staff.
 */

export type CodRow = { line: number; awb: string; amountPaise: number; utr: string | null; remittedOn: Date | null };
export type ReceiptStatus = "matched" | "short" | "excess" | "unknown_awb" | "not_cod" | "accepted";
export const RECEIPT_LABEL: Record<ReceiptStatus, string> = {
  matched: "Received in full", short: "Courier paid less", excess: "Courier paid more", unknown_awb: "AWB not found", not_cod: "Not a COD order", accepted: "Accepted by staff",
};
/** Courier and order amounts may differ by rounding only. */
const TOLERANCE_PAISE = 100;
export const MAX_COD_ROWS = 5000;

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const AWB_COL = [/^(awb|awb no|awb number|awb num|airway bill( no| number)?|waybill|waybill no|waybill number|tracking (id|no|number)|lr no|lr number|lrn|docket( no)?)$/, /\b(awb|waybill)\b/];
const AMOUNT_COL = [/^(cod amount|cod amt|cod value|remitted amount|remittance amount|amount remitted|collected amount|cod collected|net cod|cod remitted)$/, /\bcod\b.*\b(amount|amt|value)\b|\bremit\w*\b.*\bamount\b|\bamount\b.*\bremit\w*\b|\bcollected\b/, /^(amount|net amount|amount rs|amount inr)$/];
const UTR_COL = [/\butr\b/, /^(bank ref( no)?|bank reference( no| number)?|transaction (id|ref|no|number)|payment ref( no)?|reference( no| number)?|ref no)$/];
const DATE_COL = [/\b(remittance|remitted|payment|settlement|utr|transfer|paid)\b.*\bdate\b|\bdate\b.*\b(remittance|remitted|payment|settlement)\b/, /^(date|remittance date|payment date)$/];

function findCol(header: string[], pats: RegExp[], not: RegExp = /\b(charge|charges|fee|freight|gst|tax)\b/) {
  for (const p of pats) { const i = header.findIndex((h) => p.test(h) && !not.test(h)); if (i >= 0) return i; }
  return -1;
}

/** "₹ 1,234.50" → 123450 paise; anything else → NaN. */
export function rupeesToPaise(v: string): number {
  const t = String(v ?? "").replace(/₹|rs\.?|inr/gi, "").replace(/,/g, "").trim();
  if (!/^-?\d+(\.\d+)?$/.test(t)) return NaN;
  return Math.round(Number(t) * 100);
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
/** dd-mm-yyyy, dd/mm/yyyy, yyyy-mm-dd, "24 Nov 2026", or a spreadsheet's own date text. Noon IST, so the day never shifts. */
export function parseDay(v: string): Date | null {
  const t = String(v ?? "").trim();
  if (!t) return null;
  let y: number, m: number, d: number;
  let x = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (x) { y = +x[1]; m = +x[2]; d = +x[3]; }
  else if ((x = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/))) { d = +x[1]; m = +x[2]; y = +x[3] < 100 ? 2000 + +x[3] : +x[3]; }
  else if ((x = t.match(/^(\d{1,2})[\s-]([a-z]{3})[a-z]*[\s-,]+(\d{4})/i)) && MONTHS.includes(x[2].toLowerCase())) { d = +x[1]; m = MONTHS.indexOf(x[2].toLowerCase()) + 1; y = +x[3]; }
  else { const dt = new Date(t); if (Number.isNaN(+dt)) return null; return new Date(`${dt.toISOString().slice(0, 10)}T12:00:00+05:30`); }
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  return new Date(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T12:00:00+05:30`);
}

const cleanAwb = (v: string) => String(v ?? "").replace(/^'+/, "").replace(/\s+/g, "").replace(/\.0+$/, "").toUpperCase();

/** Rows of a courier's COD remittance sheet (first rows may be a title; the header row is found by its columns). */
export function codRowsFromGrid(grid: string[][]): { rows: CodRow[]; error?: string } {
  for (let h = 0; h < Math.min(grid.length, 15); h++) {
    const header = grid[h].map(norm);
    const a = findCol(header, AWB_COL), m = findCol(header, AMOUNT_COL);
    if (a < 0 || m < 0) continue;
    const u = findCol(header, UTR_COL, /\b(awb|waybill)\b/), dt = findCol(header, DATE_COL, /\b(pickup|delivered|delivery|booking|order|manifest)\b/);
    const rows: CodRow[] = [];
    for (let i = h + 1; i < grid.length && rows.length < MAX_COD_ROWS; i++) {
      const r = grid[i];
      const awb = cleanAwb(r[a] ?? "");
      if (!/^[A-Z0-9-]{6,30}$/.test(awb)) continue; // totals, blank and note rows
      rows.push({ line: i + 1, awb, amountPaise: rupeesToPaise(r[m] ?? ""), utr: u >= 0 ? (String(r[u] ?? "").trim() || null) : null, remittedOn: dt >= 0 ? parseDay(r[dt] ?? "") : null });
    }
    return { rows };
  }
  return { rows: [], error: "No AWB and COD amount columns found. The file needs an AWB / Waybill column and a COD amount column." };
}

/**
 * A Delhivery COD remittance e-mail (text). Its table comes through as lines of cells; each line with a waybill
 * (10–16 digits) and an amount is one AWB. The UTR and date are read from the mail when the table has none.
 */
export function codRowsFromMail(subject: string, text: string): CodRow[] {
  if (!/\bcod\b/i.test(`${subject} ${text}`) || !/remit|settle/i.test(`${subject} ${text}`)) return [];
  const lines = text.split(/\n/);
  // a header row with columns → read it like a sheet (cells separated by tabs, "|" or 2+ spaces)
  const grid = lines.map((l) => l.split(/\t|\s*\|\s*|\s{2,}/).map((c) => c.trim()).filter((c, i, all) => c || i < all.length - 1));
  const sheet = codRowsFromGrid(grid);
  const mailUtr = text.match(/\bUTR\b[\s:#.-]*(?:no\.?|number)?[\s:#.-]*([A-Z0-9]{8,30})/i)?.[1] ?? null;
  const mailDay = parseDay(text.match(/\b(?:remittance|payment|transfer|credit|value)\s*date\b[\s:-]*([0-9]{1,4}[-/.][0-9a-z]{1,3}[-/.][0-9]{2,4}|\d{1,2}\s+[a-z]{3}[a-z]*,?\s+\d{4})/i)?.[1] ?? "");
  if (sheet.rows.length) return sheet.rows.map((r) => ({ ...r, utr: r.utr ?? mailUtr, remittedOn: r.remittedOn ?? mailDay }));
  // no header: "<waybill> … <amount>" lines
  const out: CodRow[] = [];
  lines.forEach((l, i) => {
    const awb = l.match(/(?:^|\s)(\d{10,16})(?=\s|$)/)?.[1];
    if (!awb) return;
    const money = [...l.matchAll(/(?:₹|rs\.?|inr)?\s*(\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})|\d+\.\d{1,2})(?=\s|$)/gi)].map((x) => rupeesToPaise(x[1])).filter((n) => Number.isFinite(n));
    if (!money.length) return;
    out.push({ line: i + 1, awb, amountPaise: money[money.length - 1], utr: mailUtr, remittedOn: mailDay });
  });
  return out;
}

export type ImportedRow = CodRow & { status: ReceiptStatus | "invalid"; expectedPaise: number | null; orgName: string | null; orderNumber: string | null; message?: string };

/**
 * Record what the courier paid. Preview (commit = false) writes nothing. A re-sent file updates the AWB's row; an
 * amount staff accepted stays accepted while the courier's amount is unchanged. AWBs already paid to the client are
 * recorded but never paid twice (payouts take each shipment once).
 */
export async function importCodReceipts(rows: CodRow[], opts: { source: "delhivery_mail" | "courier_file"; fileName?: string | null; actorUserId: string | null; commit: boolean }) {
  const db = await getDb();
  const S = schema.shipments, O = schema.orders;
  const awbs = [...new Set(rows.map((r) => r.awb))];
  const found = awbs.length ? await db.select({ s: S, o: O, org: schema.orgs.businessName }).from(S).innerJoin(O, eq(O.id, S.orderId)).innerJoin(schema.orgs, eq(schema.orgs.id, S.orgId))
    .where(or(inArray(S.awb, awbs), inArray(S.lrNumber, awbs))) : [];
  const byAwb = new Map<string, (typeof found)[number]>();
  for (const f of found) { if (f.s.awb) byAwb.set(f.s.awb.toUpperCase(), f); if (f.s.lrNumber && !byAwb.has(f.s.lrNumber.toUpperCase())) byAwb.set(f.s.lrNumber.toUpperCase(), f); }
  const prior = awbs.length ? await db.select().from(schema.codReceipts).where(inArray(schema.codReceipts.awb, awbs)) : [];
  const priorBy = new Map(prior.map((p) => [p.awb, p]));
  const seen = new Set<string>();
  const out: ImportedRow[] = [];
  for (const r of rows) {
    if (seen.has(r.awb)) { out.push({ ...r, status: "invalid", expectedPaise: null, orgName: null, orderNumber: null, message: "Same AWB again in this file (first row used)" }); continue; }
    seen.add(r.awb);
    if (!Number.isFinite(r.amountPaise) || r.amountPaise < 0) { out.push({ ...r, status: "invalid", expectedPaise: null, orgName: null, orderNumber: null, message: "COD amount is not a number" }); continue; }
    const f = byAwb.get(r.awb);
    let status: ReceiptStatus;
    if (!f) status = "unknown_awb";
    else if (f.o.paymentType !== "cod" || f.o.codAmountPaise <= 0) status = "not_cod";
    else if (Math.abs(r.amountPaise - f.o.codAmountPaise) <= TOLERANCE_PAISE) status = "matched";
    else status = r.amountPaise < f.o.codAmountPaise ? "short" : "excess";
    const p = priorBy.get(r.awb);
    if (p?.status === "accepted" && p.amountPaise === r.amountPaise && status !== "matched") status = "accepted";
    out.push({ ...r, status, expectedPaise: f ? f.o.codAmountPaise : null, orgName: f?.org ?? null, orderNumber: f?.o.orderNumber ?? null });
  }
  const valid = out.filter((r): r is ImportedRow & { status: ReceiptStatus } => r.status !== "invalid");
  const summary = {
    rows: out, matched: valid.filter((r) => r.status === "matched" || r.status === "accepted").length,
    flagged: valid.filter((r) => r.status !== "matched" && r.status !== "accepted").length,
    totalPaise: valid.reduce((t, r) => t + r.amountPaise, 0), importId: null as string | null,
  };
  if (!opts.commit || !valid.length) return summary;
  const importId = newId("cri");
  await db.transaction(async (tx) => {
    await tx.insert(schema.codReceiptImports).values({ id: importId, source: opts.source, fileName: opts.fileName ?? null, rows: valid.length, matched: summary.matched, flagged: summary.flagged, totalPaise: summary.totalPaise, createdBy: opts.actorUserId });
    for (const r of valid) {
      const f = byAwb.get(r.awb);
      const v = { shipmentId: f?.s.id ?? null, orgId: f?.s.orgId ?? null, amountPaise: r.amountPaise, expectedPaise: r.expectedPaise, utr: r.utr, remittedOn: r.remittedOn, status: r.status, importId };
      await tx.insert(schema.codReceipts).values({ id: newId("crc"), awb: r.awb, ...v }).onConflictDoUpdate({ target: schema.codReceipts.awb, set: { ...v, updatedAt: new Date() } });
    }
  });
  summary.importId = importId;
  return summary;
}

/** Staff accept a courier amount that differs from the order (e.g. a partial collection): that amount is paid to the client. */
export async function acceptReceipt(id: string, actorUserId: string) {
  const db = await getDb();
  const [r] = await db.select().from(schema.codReceipts).where(eq(schema.codReceipts.id, id));
  if (!r) return { ok: false as const, message: "Not found" };
  if (!r.shipmentId || r.status === "unknown_awb" || r.status === "not_cod") return { ok: false as const, message: "Only a COD order of ours can be accepted" };
  if (r.status === "matched" || r.status === "accepted") return { ok: true as const, receipt: r };
  const [u] = await db.update(schema.codReceipts).set({ status: "accepted", resolvedBy: actorUserId, updatedAt: new Date() }).where(eq(schema.codReceipts.id, id)).returning();
  return { ok: true as const, receipt: u };
}
