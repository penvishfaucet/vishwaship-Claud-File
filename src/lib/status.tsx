/** Normalized shipment statuses -> label + existing live-site chip class (c-*). */
export const SHIPMENT_STATUS: Record<string, { label: string; chip: string }> = {
  booked: { label: "Booked", chip: "c-pending" },
  pickup_pending: { label: "Pickup pending", chip: "c-pickup_pending" },
  picked_up: { label: "Picked up", chip: "c-picked_up" },
  in_transit: { label: "In transit", chip: "c-in_transit" },
  at_delivery_center: { label: "At delivery centre", chip: "c-in_transit" },
  out_for_delivery: { label: "Out for delivery", chip: "c-out_for_delivery" },
  delivered: { label: "Delivered", chip: "c-delivered" },
  ndr: { label: "Undelivered (NDR)", chip: "c-ndr" },
  cancelled: { label: "Cancelled", chip: "c-cancelled" },
  rto_initiated: { label: "RTO initiated", chip: "c-rto" },
  rto_in_transit: { label: "RTO in transit", chip: "c-rto_in_transit" },
  rto_delivered: { label: "RTO delivered", chip: "c-rto_delivered" },
  lost: { label: "Lost", chip: "c-lost" },
  reverse_in_transit: { label: "Reverse in transit", chip: "c-in_transit" },
  reverse_delivered: { label: "Reverse delivered", chip: "c-delivered" },
};

export const statusLabel = (s: string) => SHIPMENT_STATUS[s]?.label ?? s.replace(/_/g, " ");
export const statusChip = (s: string) => SHIPMENT_STATUS[s]?.chip ?? "c-pending";

export function StatusChip({ status }: { status: string }) {
  return <span className={`chip ${statusChip(status)}`}>{statusLabel(status)}</span>;
}

/** Tiles on the dashboard / tabs on Orders, each a group of normalized statuses. */
export const STATUS_GROUPS: Array<{ key: string; label: string; statuses: string[] }> = [
  { key: "pickup", label: "Pickup pending", statuses: ["booked", "pickup_pending"] },
  { key: "transit", label: "In transit", statuses: ["picked_up", "in_transit", "at_delivery_center"] },
  { key: "ofd", label: "Out for delivery", statuses: ["out_for_delivery"] },
  { key: "delivered", label: "Delivered", statuses: ["delivered"] },
  { key: "ndr", label: "NDR", statuses: ["ndr"] },
  { key: "rto", label: "RTO", statuses: ["rto_initiated", "rto_in_transit", "rto_delivered"] },
  { key: "cancelled", label: "Cancelled", statuses: ["cancelled"] },
];
