import { apiCustomer } from "@/server/auth/session";
import { audit } from "@/server/audit";
import { apiError } from "@/server/http";
import { listOrderRows, parseOrderFilters } from "@/server/orders/view";
import { toCsv } from "@/lib/csv";
import { COD_DISPLAY, codDisplay } from "@/lib/order-view";
import { statusLabel } from "@/lib/status";

const rupees = (p: number | null | undefined) => (p == null ? "" : (p / 100).toFixed(2));
const kg = (g: number | null | undefined) => (g ? (g / 1000).toFixed(2) : "");
const ist = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "");

/** CSV of exactly what the Orders screen shows for the same URL filters and tab (all pages, up to 10,000 rows). */
export async function GET(req: Request) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const sp = Object.fromEntries(new URL(req.url).searchParams.entries());
  const f = parseOrderFilters(sp);
  const d = await listOrderRows(s.orgId, f, { limit: 10_000, offset: 0 });
  const headers = ["Order date (IST)", "Order ID", "Customer reference", "Source", "Direction", "Type", "Products", "SKUs", "Quantity", "Boxes",
    "Dead weight kg", "Volumetric kg", "Chargeable kg", "Carrier weight kg", "Payment mode", "Invoice value (INR)", "COD amount (INR)", "Shipping charged (INR)", "Receiver freight FOD (INR)",
    "Courier", "Service", "AWB", "LR", "Shipment status", "Last location", "Last scan (IST)", "Last sync (IST)",
    "Recipient", "Recipient mobile", "Address", "City", "State", "PIN", "Pickup warehouse", "Pickup address", "WhatsApp COD confirmation", "COD cancellation"];
  const rows = d.rows.map((r) => {
    const cod = codDisplay(r.cod);
    const c = r.consignee, p = r.pickup;
    return [ist(r.createdAt), r.orderNumber, r.externalOrderId ?? r.invoiceNumber ?? "", r.source, r.direction, r.isMps ? "MPS" : r.mode,
      r.products.map((x) => x.name).join(" | "), r.products.map((x) => x.sku).filter(Boolean).join(" | "), r.products.reduce((t, x) => t + x.qty, 0), r.boxes,
      kg(r.actualGrams), kg(r.volumetricGrams), kg(r.chargeableGrams), kg(r.carrierGrams), r.payment.toUpperCase(), rupees(r.invoicePaise), r.payment === "cod" ? rupees(r.codPaise) : "",
      rupees(r.chargedPaise), r.payment === "fod" ? rupees(r.receiverFreightPaise) : "",
      r.shipment?.carrierName ?? "", r.shipment?.serviceName ?? "", r.shipment ? r.shipment.awb ?? "AWB Pending" : "", r.shipment?.lr ?? "",
      r.shipment ? statusLabel(r.shipment.status) : r.orderStatus, r.shipment?.lastLocation ?? "", ist(r.shipment?.lastEventAt), ist(r.shipment?.lastSyncAt),
      c.name ?? "", c.mobile ?? "", [c.line1, c.line2].filter(Boolean).join(", "), c.city ?? "", c.state ?? "", c.pincode ?? "",
      p?.label ?? "", p ? [p.line1, p.line2, p.city, p.state, p.pincode].filter(Boolean).join(", ") : "",
      COD_DISPLAY[cod.buyer].label, cod.cancellation ? COD_DISPLAY[cod.cancellation].label : ""];
  });
  await audit({ actorUserId: s.userId, actorKind: s.impersonatorId ? "staff" : "customer", orgId: s.orgId, action: "orders.export", targetType: "export", targetId: f.tab, details: { rows: rows.length, tab: f.tab, from: f.from, to: f.to } });
  return new Response(toCsv(headers, rows), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="orders-${f.tab}-${f.from}-to-${f.to}.csv"`, "cache-control": "private, no-store" } });
}
