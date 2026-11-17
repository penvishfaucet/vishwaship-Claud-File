import { and, eq } from "drizzle-orm";
import { apiCustomer } from "@/server/auth/session";
import { getDb, schema } from "@/server/db/client";
import { apiError } from "@/server/http";
import { formatINR } from "@/lib/money";
import { type InvoiceLook, invoiceDocHtml } from "@/lib/sales-invoice";
import { orgSetting } from "@/server/couriers";

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
  const look = await orgSetting<InvoiceLook>(s.orgId, "invoice_settings");
  const html = invoiceDocHtml(look ?? { businessName: row.org.businessName, gstin: row.org.gstin ?? "", address: pw ? `${pw.line1}, ${pw.city} ${pw.pincode}` : "" }, {
    number: row.o.invoiceNumber ?? row.o.orderNumber, date: row.o.createdAt.toLocaleDateString("en-IN"), consignee: c, buyerGstin: row.o.buyerGstin, items,
    payment: row.o.paymentType === "cod" ? `Cash on delivery ${formatINR(row.o.codAmountPaise)}` : "Prepaid", shippedVia: `${row.s.carrierName} AWB ${row.s.awb ?? ""}`, ewayBill: row.o.ewayBill,
  });
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store" } });
}
