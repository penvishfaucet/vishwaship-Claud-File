import { and, desc, eq, gte, lte } from "drizzle-orm";
import { apiCustomer } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { getDb, schema } from "@/server/db/client";
import { apiError } from "@/server/http";
import { listOrders } from "@/server/portal/queries";
import { toCsv } from "@/lib/csv";
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
    const l = await db.select({ s: schema.shipments, o: schema.orders }).from(schema.shipments).innerJoin(schema.orders, eq(schema.orders.id, schema.shipments.orderId)).where(and(eq(schema.shipments.orgId, s.orgId), gte(schema.shipments.createdAt, from), lte(schema.shipments.createdAt, to)));
    headers = ["Date (IST)", "Order", "AWB", "Courier", "Chargeable kg", "Charged incl. GST (INR)"];
    rows = l.map(({ s: x, o }) => [x.createdAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }), o.orderNumber, x.awb, x.carrierName, (x.chargeableWeightGrams / 1000).toFixed(2), rupees(x.sellPaise)]);
    const total = l.reduce((t, r) => t + r.s.sellPaise, 0);
    rows.push(["TOTAL", "", "", "", "", rupees(total)]);
  } else if (kind === "warehouses") {
    let w = await db.select().from(schema.warehouses).where(eq(schema.warehouses.orgId, s.orgId));
    const q = u.searchParams.get("q")?.toLowerCase(), code = u.searchParams.get("code")?.toLowerCase(), st = u.searchParams.get("status");
    if (q) w = w.filter((x) => x.label.toLowerCase().includes(q));
    if (code) w = w.filter((x) => (x.code ?? x.id).toLowerCase().includes(code));
    if (st === "active") w = w.filter((x) => x.active); if (st === "inactive") w = w.filter((x) => !x.active);
    headers = ["ID", "Title", "Contact name", "Email", "Mobile", "Mobile verified", "Address", "City", "State", "Pincode", "Default", "Status", "Created by", "Created at (IST)"];
    rows = w.map((x) => [x.code ?? x.id, x.label, x.contactName, x.email ?? "", x.mobile, x.mobileVerifiedAt ? "Yes" : "No", [x.line1, x.line2].filter(Boolean).join(", "), x.city, x.state, x.pincode, x.isDefault ? "Yes" : "No", x.active ? "Active" : "Inactive", x.createdBy ?? "", x.createdAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })]);
  } else {
    return apiError(422, "validation_error", `Export "${kind}" is not available yet`);
  }
  await audit({ actorUserId: s.userId, actorKind: "customer", orgId: s.orgId, action: "export", details: { kind, rows: rows.length } });
  const name = `vishwaship-${kind}-${new Date().toISOString().slice(0, 10)}`;
  if (u.searchParams.get("format") === "xlsx") {
    return new Response(await toXlsx(kind, headers, rows), { headers: { "content-type": XLSX_TYPE, "content-disposition": `attachment; filename="${name}.xlsx"`, "cache-control": "private, no-store" } });
  }
  return new Response(toCsv(headers, rows), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}.csv"`, "cache-control": "private, no-store" } });
}
