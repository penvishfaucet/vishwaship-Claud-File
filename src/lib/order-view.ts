/**
 * Orders view: status tabs, WhatsApp COD confirmation display status and label print formats.
 * Pure + client-safe. The SQL mapping in server/orders/view.ts uses the same TAB_RULES so tab
 * counts, filters and tracking updates always agree.
 */

export type TabKey =
  | "drafts" | "new" | "courier_assigned" | "pickups"
  | "in_transit" | "out_for_delivery" | "delivered"
  | "ndr" | "rto_in_transit" | "rto_delivered"
  | "all" | "archive";

export const TAB_GROUPS: Array<{ title: string; tabs: Array<{ key: TabKey; label: string }> }> = [
  { title: "Shipment Booking", tabs: [{ key: "drafts", label: "Drafts" }, { key: "new", label: "New" }, { key: "courier_assigned", label: "Courier Assigned" }, { key: "pickups", label: "Pickups & Manifests" }] },
  { title: "Shipment Journey", tabs: [{ key: "in_transit", label: "In Transit" }, { key: "out_for_delivery", label: "Out For Delivery" }, { key: "delivered", label: "Delivered" }] },
  { title: "NDR Exceptions", tabs: [{ key: "ndr", label: "NDR" }, { key: "rto_in_transit", label: "RTO In-Transit" }, { key: "rto_delivered", label: "RTO Delivered" }] },
  { title: "", tabs: [{ key: "all", label: "All" }, { key: "archive", label: "Archive" }] },
];
export const TAB_KEYS = TAB_GROUPS.flatMap((g) => g.tabs.map((t) => t.key));
export const isTab = (v: unknown): v is TabKey => typeof v === "string" && (TAB_KEYS as string[]).includes(v);

/** Normalized shipment status → journey tab (shipment exists and is not cancelled). */
export const STATUS_TAB: Record<string, TabKey> = {
  booked: "courier_assigned", // becomes "pickups" once a pickup is scheduled
  pickup_pending: "pickups",
  picked_up: "in_transit", in_transit: "in_transit", at_delivery_center: "in_transit", reverse_in_transit: "in_transit",
  out_for_delivery: "out_for_delivery",
  delivered: "delivered", reverse_delivered: "delivered",
  ndr: "ndr",
  rto_initiated: "rto_in_transit", rto_in_transit: "rto_in_transit",
  rto_delivered: "rto_delivered",
};

/**
 * Which tab an order belongs to. `cancelled` and `lost` orders appear only under All.
 * Mirrors tabSql() in server/orders/view.ts — keep both in step (unit-tested).
 */
export function tabOf(o: { archived: boolean; orderStatus: string; shipment: null | { bookingStatus: string; status: string; pickupStatus: string } }): TabKey | "other" {
  if (o.archived) return "archive";
  const s = o.shipment;
  if (o.orderStatus === "cancelled") return "other";
  if (!s && o.orderStatus === "draft") return "drafts"; // saved as draft: not ready for a courier yet
  if (!s || s.bookingStatus === "failed") return "new"; // a failed booking can be booked again
  if (s.status === "cancelled") return "other";
  if (s.status === "booked") return s.pickupStatus === "not_scheduled" ? "courier_assigned" : "pickups";
  return STATUS_TAB[s.status] ?? "other";
}

/** Legacy ?group= links (dashboard, bulk upload) → new tabs. */
export const LEGACY_GROUP: Record<string, TabKey> = { drafts: "drafts", pickup: "pickups", transit: "in_transit", ofd: "out_for_delivery", delivered: "delivered", ndr: "ndr", rto: "rto_in_transit" };

// ---------------------------------------------------------------- WhatsApp COD confirmation

export type CodDisplay =
  | "setup_required" | "disabled" | "not_applicable" | "pending" | "sent" | "delivered"
  | "confirmed" | "rejected" | "no_response" | "message_failed"
  | "cancellation_pending" | "cancelled" | "cancellation_failed";

export const COD_DISPLAY: Record<CodDisplay, { label: string; tone: "muted" | "info" | "ok" | "warn" | "bad" }> = {
  setup_required: { label: "Setup Required", tone: "warn" },
  disabled: { label: "Disabled", tone: "muted" },
  not_applicable: { label: "Not Applicable", tone: "muted" },
  pending: { label: "Pending", tone: "info" },
  sent: { label: "Sent", tone: "info" },
  delivered: { label: "Delivered", tone: "info" },
  confirmed: { label: "Confirmed", tone: "ok" },
  rejected: { label: "Rejected", tone: "bad" },
  no_response: { label: "No Response", tone: "warn" },
  message_failed: { label: "Message Failed", tone: "bad" },
  cancellation_pending: { label: "Cancellation Pending", tone: "warn" },
  cancelled: { label: "Cancelled", tone: "bad" },
  cancellation_failed: { label: "Cancellation Failed / Action Required", tone: "bad" },
};

export interface CodInputs {
  paymentType: string;
  /** Plan / subscription includes COD confirmation. */
  included: boolean;
  /** Customer toggle: null = never configured. */
  enabled: boolean | null;
  confirmation: null | { status: string; cancellationStatus: string | null };
  /** Latest WhatsApp message status for the confirmation (queued | sent | delivered | read | failed | skipped). */
  messageStatus: string | null;
}

/**
 * Buyer-confirmation status and (separately) the cancellation status, so the row can show both
 * — e.g. "Rejected" + "Cancellation Pending".
 */
export function codDisplay(i: CodInputs): { buyer: CodDisplay; cancellation: CodDisplay | null; reason?: string } {
  if (i.paymentType !== "cod") return { buyer: "not_applicable", cancellation: null, reason: i.paymentType === "fod" ? "Freight-on-delivery order" : "Prepaid order" };
  const c = i.confirmation;
  if (!c) {
    if (!i.included || i.enabled === null) return { buyer: "setup_required", cancellation: null, reason: i.included ? "Turn on COD Confirmation in Settings" : "Not included in your plan" };
    if (!i.enabled) return { buyer: "disabled", cancellation: null, reason: "COD Confirmation is switched off" };
    return { buyer: "not_applicable", cancellation: null, reason: "Order was created before COD Confirmation was switched on" };
  }
  const cancellation: CodDisplay | null =
    c.cancellationStatus === "requested" ? "cancellation_pending"
      : c.cancellationStatus === "cancelled" ? "cancelled"
        : c.cancellationStatus === "failed" || c.cancellationStatus === "action_required" ? "cancellation_failed" : null;
  let buyer: CodDisplay;
  switch (c.status) {
    case "confirmed": buyer = "confirmed"; break;
    case "rejected": buyer = "rejected"; break;
    case "no_response": case "expired": buyer = "no_response"; break;
    case "send_failed": buyer = "message_failed"; break;
    default: // pending | needs_review
      buyer = i.messageStatus === "failed" ? "message_failed"
        : i.messageStatus === "delivered" || i.messageStatus === "read" ? "delivered"
          : i.messageStatus === "sent" ? "sent" : "pending";
  }
  return { buyer, cancellation, reason: c.status === "needs_review" ? "Buyer reply could not be matched to one order — review it" : undefined };
}

/** COD statuses offered in More Filters (mapped to SQL in server/orders/view.ts). */
export const COD_FILTERS: Array<{ key: string; label: string }> = [
  { key: "pending", label: "Pending / Sent" }, { key: "confirmed", label: "Confirmed" }, { key: "rejected", label: "Rejected" },
  { key: "no_response", label: "No Response" }, { key: "message_failed", label: "Message Failed" },
  { key: "cancellation_pending", label: "Cancellation Pending" }, { key: "cancelled", label: "Cancelled" }, { key: "cancellation_failed", label: "Cancellation Failed" },
];

// ---------------------------------------------------------------- labels

export type PrintFormat = "thermal_3x4" | "thermal_4x4" | "thermal_2x4" | "thermal_38x100" | "original";
export const PRINT_FORMATS: Array<{ key: PrintFormat; name: string; w?: string; h?: string; mm?: [number, number] }> = [
  { key: "thermal_3x4", name: "3 × 4 inches", w: "3in", h: "4in", mm: [76.2, 101.6] },
  { key: "thermal_4x4", name: "4 × 4 inches", w: "4in", h: "4in", mm: [101.6, 101.6] },
  { key: "thermal_2x4", name: "2 × 4 inches", w: "2in", h: "4in", mm: [50.8, 101.6] },
  { key: "thermal_38x100", name: "38 × 100 mm", w: "38mm", h: "100mm", mm: [38, 100] },
  { key: "original", name: "Original carrier format" },
];

/**
 * Smallest page edge (mm) a carrier image label may be scaled into while keeping its barcode
 * readable. A 4×6 in label scaled below ~60 % loses narrow bars on 203 dpi printers.
 */
export const MIN_SCALE = 0.6;
export function fitScale(src: [number, number], page: [number, number]) {
  return Math.min(page[0] / src[0], page[1] / src[1]);
}

// ---------------------------------------------------------------- table columns

export const OPTIONAL_COLUMNS = [
  { key: "orderDate", label: "Order Date" },
  { key: "product", label: "Product Details" },
  { key: "package", label: "Package Details" },
  { key: "shipping", label: "Shipping Details" },
  { key: "pickup", label: "Pickup Address" },
  { key: "codLine", label: "WhatsApp COD confirmation line" },
] as const;
export type OptionalColumn = (typeof OPTIONAL_COLUMNS)[number]["key"];
export const PAGE_SIZES = [10, 25, 50, 100] as const;
