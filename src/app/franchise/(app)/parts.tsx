import { rupeesText } from "@/lib/franchise";
import type { ShipmentRow } from "@/server/franchise/portal";

export const day = (d: Date | null) => (d ? d.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", year: "numeric" }) : "—");
const STATUS_TEXT: Record<string, string> = {
  booked: "Booked", pickup_pending: "Pickup pending", pickup_scheduled: "Pickup scheduled", rto_in_transit: "Returning (RTO)", picked_up: "Picked up", in_transit: "In transit", out_for_delivery: "Out for delivery", delivered: "Delivered",
  ndr: "Delivery attempt failed", rto_initiated: "Returning (RTO)", rto_delivered: "Returned (RTO)", cancelled: "Cancelled", lost: "Lost",
};
export const shipStatus = (s: string, booking: string) => (booking === "cancelled" ? "Cancelled" : STATUS_TEXT[s] ?? s.replace(/_/g, " "));
const chip = (s: string, booking: string) => (booking === "cancelled" || s.startsWith("rto") || s === "lost" ? "c-failed" : s === "delivered" ? "c-active" : "c-draft");

export function ShipmentTable({ rows, showCustomer, empty }: { rows: ShipmentRow[]; showCustomer?: boolean; empty: string }) {
  if (!rows.length) return <p className="small muted" style={{ padding: 16, margin: 0 }}>{empty}</p>;
  return (
    <div className="tbl-wrap"><table className="tbl">
      <thead><tr><th>Date</th>{showCustomer && <th>Customer</th>}<th>Order / AWB</th><th>Courier</th><th>To</th><th>Payment</th><th>Amount</th><th>Status</th></tr></thead>
      <tbody>{rows.map((r) => (
        <tr key={r.id}>
          <td className="small">{day(r.createdAt)}</td>
          {showCustomer && <td className="small"><a href={`/franchise/customers/${r.orgId}/`}>{r.business}</a></td>}
          <td className="small"><span className="mono">{r.orderNumber}</span>{r.awb && <div className="tiny muted mono">{r.awb}</div>}</td>
          <td className="small">{r.carrierName}</td>
          <td className="small">{r.city}{r.pincode && <span className="muted"> {r.pincode}</span>}</td>
          <td className="small">{r.paymentType === "cod" ? "COD" : "Prepaid"}</td>
          <td className="small">{rupeesText(r.sellPaise)}</td>
          <td><span className={`chip ${chip(r.status, r.bookingStatus)}`}>{shipStatus(r.status, r.bookingStatus)}</span></td>
        </tr>
      ))}</tbody>
    </table></div>
  );
}
