import { and, eq } from "drizzle-orm";
import { apiCustomer } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { apiError } from "@/server/http";
import { formatINR } from "@/lib/money";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Shipment commercial invoice (seller → buyer), printable. GST tax invoice for Vishwaship charges is issued monthly in Billing. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const { id } = await params;
  const db = await getDb();
  const [row] = await db.select({ s: schema.shipments, o: schema.orders, org: schema.orgs, w: schema.warehouses }).from(schema.shipments)
    .innerJoin(schema.orders, eq(schema.orders.id, schema.shipments.orderId)).innerJoin(schema.orgs, eq(schema.orgs.id, schema.shipments.orgId))
    .leftJoin(schema.warehouses, eq(schema.warehouses.id, schema.orders.warehouseId))
    .where(and(eq(schema.shipments.id, id), eq(schema.shipments.orgId, s.orgId)));
  if (!row) return apiError(404, "not_found", "Not found");
  const snap = row.o.pickupSnapshot as { line1: string; city: string; pincode: string } | null;
  const pw = snap ?? row.w;
  const c = row.o.consignee as { name: string; line1: string; city: string; state: string; pincode: string };
  const items = row.o.products as Array<{ name: string; qty: number; unitPrice: number; hsn?: string }>;
  const total = items.reduce((t, i) => t + i.qty * i.unitPrice, 0);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Invoice ${esc(row.o.invoiceNumber ?? row.o.orderNumber)}</title>
<style>@page{size:A4;margin:14mm}body{font:12px/1.5 Arial,sans-serif;color:#111}table{width:100%;border-collapse:collapse}td,th{border:1px solid #999;padding:6px;text-align:left}th{background:#f2f2f2}.r{text-align:right}.g{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:12px 0}</style></head>
<body onload="window.print()"><h2 style="margin:0">Invoice</h2><div>No. ${esc(row.o.invoiceNumber ?? row.o.orderNumber)} · ${row.o.createdAt.toLocaleDateString("en-IN")}</div>
<div class="g"><div><b>Seller</b><br>${esc(row.org.businessName)}<br>${esc(pw?.line1)}, ${esc(pw?.city)} ${esc(pw?.pincode)}${row.org.gstin ? `<br>GSTIN ${esc(row.org.gstin)}` : ""}</div>
<div><b>Ship to</b><br>${esc(c.name)}<br>${esc(c.line1)}, ${esc(c.city)}, ${esc(c.state)} ${esc(c.pincode)}${row.o.buyerGstin ? `<br>GSTIN ${esc(row.o.buyerGstin)}` : ""}</div></div>
<table><thead><tr><th>Item</th><th>HSN</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Amount</th></tr></thead><tbody>
${items.map((i) => `<tr><td>${esc(i.name)}</td><td>${esc(i.hsn ?? "")}</td><td class="r">${i.qty}</td><td class="r">${esc(formatINR(i.unitPrice))}</td><td class="r">${esc(formatINR(i.qty * i.unitPrice))}</td></tr>`).join("")}
<tr><th colspan="4" class="r">Total</th><th class="r">${esc(formatINR(total))}</th></tr></tbody></table>
<p>Payment: ${row.o.paymentType === "cod" ? `Cash on delivery ${esc(formatINR(row.o.codAmountPaise))}` : "Prepaid"} · Shipped via ${esc(row.s.carrierName)} AWB ${esc(row.s.awb)}${row.o.ewayBill ? ` · E-way bill ${esc(row.o.ewayBill)}` : ""}</p></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store" } });
}
