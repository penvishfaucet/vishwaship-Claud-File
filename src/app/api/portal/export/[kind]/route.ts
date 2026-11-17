import { and, desc, eq, gte, lte } from "drizzle-orm";
import { apiCustomer } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db/client";
import { apiError } from "@/server/http";
import { listOrders } from "@/server/portal/queries";
import { toCsv } from "@/lib/csv";
import { codOverview, creditHistory, documentsOf, ledgerStatement, rechargesOf, shippingCharges } from "@/server/billing";
import { XLSX_TYPE, toXlsx } from "@/server/xlsx";

const rupees = (p: number) => (p / 100).toFixed(2);

/** Tenant-scoped CSV exports. /api/portal/export/report?r=<kind>&from&to also lands here. */
export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const u = new URL(req.url);
  let { kind } = await params;
  if (kind === "report") kind = u.searchParams.get("r") ?? "orders";
  // IST date range -> UTC bounds
  const from = u.searchParams.get("from") ? new Date(`${u.searchParams.get("from")}T00:00:00+05:30`) : new Date(0);
  const to = u.searchParams.get("to") ? new Date(`${u.searchParams.get("to")}T23:59:59.999+05:30`) : new Date();
  const db = await getDb();
  let headers: string[] = [], rows: unknown[][] = [];

  if (kind === "orders" || kind === "shipments") {
    const d = await listOrders(s.orgId, { q: u.searchParams.get("q") ?? undefined, group: u.searchParams.get("group") ?? undefined, payment: u.searchParams.get("payment") ?? undefined, mode: u.searchParams.get("mode") ?? undefined, pageSize: 10_000 });
    headers = ["Order ID", "Created (IST)", "Type", "Payment", "COD amount (INR)", "Consignee", "City", "PIN", "Courier", "AWB/LR", "Boxes", "Chargeable kg", "Status", "Charged (INR)"];
    rows = d.rows.filter((r) => r.createdAt >= from && r.createdAt <= to).map((r) => {
      const c = r.consignee as { name: string; city: string; pincode: string };
      return [r.orderNumber, r.createdAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }), r.mode, r.paymentType, rupees(r.codAmount), c.name, c.city, c.pincode, r.carrierName ?? "", r.awb ?? "", r.boxes, r.chargeable ? (r.chargeable / 1000).toFixed(2) : "", r.status ?? r.orderStatus, r.sell ? rupees(r.sell) : ""];
    });
  } else if (kind === "passbook") {
    const [w] = await db.select().from(schema.wallets).where(eq(schema.wallets.orgId, s.orgId));
    const l = await db.select().from(schema.ledgerEntries).where(and(eq(schema.ledgerEntries.walletId, w.id), gte(schema.ledgerEntries.createdAt, from), lte(schema.ledgerEntries.createdAt, to))).orderBy(desc(schema.ledgerEntries.createdAt));
    headers = ["Date (IST)", "Type", "Description", "Reference", "Opening (INR)", "Amount (INR)", "Closing (INR)", "On hold (INR)"];
    rows = l.map((e) => [e.createdAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }), e.kind, e.memo ?? "", e.refId ?? "", rupees(e.balanceAfterPaise - e.amountPaise), rupees(e.amountPaise), rupees(e.balanceAfterPaise), rupees(e.reservedAfterPaise)]);
  } else if (kind === "charges") {
    const l = await shippingCharges(s.orgId, from, to);
    const r2 = (p: number | null) => (p == null ? "" : rupees(p));
    headers = ["Date (IST)", "Order", "AWB / LR", "Courier", "Chargeable kg", "Freight (INR)", "COD fee (INR)", "Surcharges (INR)", "GST (INR)", "Weight adjustment (INR)", "Total (INR)"];
    rows = l.map((x) => [x.createdAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }), x.orderNumber, x.awb ?? x.lr ?? "", x.carrier, (x.chargeableGrams / 1000).toFixed(2), r2(x.freight), r2(x.codFee), r2(x.surcharges), r2(x.gst), rupees(x.weightAdjustment), rupees(x.total)]);
    rows.push(["TOTAL", "", "", "", "", "", "", "", "", "", rupees(l.reduce((t, x) => t + x.total, 0))]);
  } else if (kind === "warehouses") {
    let w = await db.select().from(schema.warehouses).where(eq(schema.warehouses.orgId, s.orgId));
    const q = u.searchParams.get("q")?.toLowerCase(), code = u.searchParams.get("code")?.toLowerCase(), st = u.searchParams.get("status");
    if (q) w = w.filter((x) => x.label.toLowerCase().includes(q));
    if (code) w = w.filter((x) => (x.code ?? x.id).toLowerCase().includes(code));
    if (st === "active") w = w.filter((x) => x.active); if (st === "inactive") w = w.filter((x) => !x.active);
    headers = ["ID", "Title", "Contact name", "Email", "Mobile", "Mobile verified", "Address", "City", "State", "Pincode", "Default", "Status", "Created by", "Created at (IST)"];
    rows = w.map((x) => [x.code ?? x.id, x.label, x.contactName, x.email ?? "", x.mobile, x.mobileVerifiedAt ? "Yes" : "No", [x.line1, x.line2].filter(Boolean).join(", "), x.city, x.state, x.pincode, x.isDefault ? "Yes" : "No", x.active ? "Active" : "Inactive", x.createdBy ?? "", x.createdAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })]);
  } else if (kind === "ledger") {
    const st = await ledgerStatement(s.orgId, from, to);
    headers = ["Date (IST)", "Particulars", "Reference", "Debit (INR)", "Credit (INR)", "Balance (INR)"];
    rows = [[from.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }), "Opening balance", "", "", "", rupees(st.opening)],
      ...st.entries.filter((e) => e.amountPaise !== 0).map((e) => [e.createdAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }), e.memo ?? e.kind, e.refId ?? "", e.amountPaise < 0 ? rupees(-e.amountPaise) : "", e.amountPaise > 0 ? rupees(e.amountPaise) : "", rupees(e.balanceAfterPaise)]),
      [to.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }), "Closing balance", "", rupees(st.debits), rupees(st.credits), rupees(st.closing)]];
  } else if (kind === "cod") {
    const c = await codOverview(s.orgId);
    headers = ["Order", "AWB", "Shipment status", "COD (INR)", "Reconciliation", "Expected payout", "Payout reference"];
    rows = c.rows.map((r) => [r.orderNumber, r.awb ?? "", r.status, rupees(r.cod), r.state, r.remittance ? r.remittance.expectedPayoutAt.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }) : "", r.remittance?.reference ?? ""]);
  } else if (kind === "recharges") {
    const r = await rechargesOf(s.orgId);
    headers = ["Date (IST)", "Amount (INR)", "Payment reference", "Order reference", "Payment status", "Wallet credited"];
    rows = r.map((x) => [x.createdAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }), rupees(x.amountPaise), x.razorpayPaymentId ?? "", x.razorpayOrderId ?? x.id, x.status, x.walletCredited ? "Yes" : "No"]);
  } else if (kind === "invoices" || kind === "credit_notes" || kind === "debit_notes") {
    const docs = await documentsOf(s.orgId, kind === "invoices" ? "invoice" : kind === "credit_notes" ? "credit_note" : "debit_note");
    headers = ["Date", "Number", "Reason / period", "Related", "Taxable (INR)", "GST (INR)", "Total (INR)"];
    rows = docs.map((x) => [x.docDate.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }), x.number, x.reason ?? (x.periodFrom ? `${x.periodFrom.toLocaleDateString("en-IN")} – ${x.periodTo?.toLocaleDateString("en-IN")}` : ""), x.refType ? `${x.refType} ${x.refId ?? ""}` : "", rupees(x.taxablePaise), rupees(x.gstPaise), rupees(x.totalPaise)]);
  } else if (kind === "credits") {
    const h = await creditHistory(s.orgId);
    headers = ["Date (IST)", "Type", "Event", "Reference", "Credits", "Balance", "Paid (INR)"];
    rows = h.map((x) => [x.createdAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }), x.type, x.event, x.refId ?? "", x.credits, x.balanceAfter, x.pricePaise ? rupees(x.pricePaise + (x.gstPaise ?? 0)) : ""]);
  } else {
    return apiError(422, "validation_error", `Export "${kind}" is not available yet`);
  }
  await audit({ actorUserId: s.userId, actorKind: s.impersonatorId ? "staff" : "customer", orgId: s.orgId, action: "export", details: { kind, rows: rows.length } });
  const name = `vishwaship-${kind}-${new Date().toISOString().slice(0, 10)}`;
  if (u.searchParams.get("format") === "xlsx") {
    return new Response(await toXlsx(kind, headers, rows), { headers: { "content-type": XLSX_TYPE, "content-disposition": `attachment; filename="${name}.xlsx"`, "cache-control": "private, no-store" } });
  }
  return new Response(toCsv(headers, rows), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}.csv"`, "cache-control": "private, no-store" } });
}
