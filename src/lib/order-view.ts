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

/**
 * Download Label formats. Every size except "original" is the Vishwaship-branded label (drawn from the booking);
 * "original" is the courier's own label, untouched (Carrier Label).
 *  - mm: physical page size (exact PDF page dimensions)
 *  - slots: A4 sheets hold several labels in a grid (cols × rows), placed in order; unused slots stay blank
 */
export type PrintFormat = "a4_1up" | "a4_fit" | "a4_doc" | "a4_2up" | "a4_4up" | "thermal_4x6" | "thermal_3x4" | "thermal_4x4" | "thermal_2x4" | "thermal_38x100" | "thermal_38x200" | "original";
export const PRINT_FORMATS: Array<{ key: PrintFormat; name: string; group: "a4" | "thermal" | "carrier"; w?: string; h?: string; mm?: [number, number]; slots?: [number, number] }> = [
  // a4_fit (default): one shipment's labels (+ B2B document) on one sheet, 2 × 2 grid, up to 4 per sheet
  { key: "a4_fit", name: "A4 · all labels of a shipment on one page", group: "a4", w: "210mm", h: "297mm", mm: [210, 297] },
  // a4_1up: one label per sheet, half-page size at the top
  { key: "a4_1up", name: "A4 · 1 label per page", group: "a4", w: "210mm", h: "297mm", mm: [210, 297], slots: [1, 1] },
  // a4_doc: up to 2 carton labels on the top half, the shipment's invoice on the bottom half
  { key: "a4_doc", name: "A4 · label + invoice on one page", group: "a4", w: "210mm", h: "297mm", mm: [210, 297] },
  { key: "a4_2up", name: "A4 · 2 labels per page", group: "a4", w: "210mm", h: "297mm", mm: [210, 297], slots: [1, 2] },
  { key: "a4_4up", name: "A4 · 4 labels per page (2 × 2)", group: "a4", w: "210mm", h: "297mm", mm: [210, 297], slots: [2, 2] },
  { key: "thermal_4x6", name: "Thermal 4 × 6 inches", group: "thermal", w: "4in", h: "6in", mm: [101.6, 152.4] },
  { key: "thermal_3x4", name: "Thermal 3 × 4 inches", group: "thermal", w: "3in", h: "4in", mm: [76.2, 101.6] },
  { key: "thermal_4x4", name: "Thermal 4 × 4 inches", group: "thermal", w: "4in", h: "4in", mm: [101.6, 101.6] },
  { key: "thermal_2x4", name: "Thermal 2 × 4 inches", group: "thermal", w: "2in", h: "4in", mm: [50.8, 101.6] },
  { key: "thermal_38x100", name: "Thermal 38 × 100 mm", group: "thermal", w: "38mm", h: "100mm", mm: [38, 100] },
  { key: "thermal_38x200", name: "Thermal 38 × 200 mm", group: "thermal", w: "38mm", h: "200mm", mm: [38, 200] },
  { key: "original", name: "Carrier label (courier's original)", group: "carrier" },
];
/** Terms printed at the foot of the Vishwaship label: full text where there is room, the short line on small rolls. */
export const LABEL_TERMS = {
  full: "Terms & Conditions: Shipped under Vishwaship and courier partner terms (vishwaship.in/terms). Contents, invoice value and GSTIN are declared by the shipper, who is responsible for them. Receiver: do not accept the parcel if its seal or packing is broken or tampered - note it on the delivery record. If undelivered, the parcel returns to the pickup address above. Prohibited and dangerous goods are not carried.",
  short: "T&C: vishwaship.in/terms | Do not accept if tampered | Undelivered: return to pickup address",
};
export const PRINT_HINT ="Print at Actual size / 100 % (turn off “Fit to page”), so barcodes scan and the label matches the roll.";

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

// ---------------------------------------------------------------- status text (Customer Portal Orders + Admin All Shipments)
import { statusLabel } from "@/lib/status";

export const STATUS_TONE: Record<string, string> = {
  booked: "amber", pickup_pending: "amber", picked_up: "blue", in_transit: "blue", at_delivery_center: "blue", out_for_delivery: "orange",
  delivered: "green", ndr: "red", rto_initiated: "red", rto_in_transit: "red", rto_delivered: "red", cancelled: "gray", lost: "red",
};
type StatusInput = { orderStatus: string; shipment: null | { bookingStatus: string; status: string; pickupStatus: string; awb: string | null; lr: string | null } };

/** Booking stage text (before the courier picks up). */
export function bookingStage(r: StatusInput): { text: string; cls: string } {
  const s = r.shipment;
  if (r.orderStatus === "cancelled" || s?.status === "cancelled") return { text: "Cancelled", cls: "red" };
  if (!s || s.bookingStatus === "failed") {
    const m: Record<string, [string, string]> = { draft: ["Draft", "gray"], ready: ["Ready — assign courier", "navy"], cod_hold: ["COD Hold", "yellow"], booking_failed: ["Booking Failed", "red"], booking: ["Booking…", "orange"], needs_reconcile: ["Confirming with courier", "orange"] };
    const [text, cls] = m[r.orderStatus] ?? ["New", "gray"];
    return { text, cls };
  }
  if (s.bookingStatus !== "confirmed") return { text: s.awb || s.lr ? "Booking Pending" : "Booked · LR/AWB pending", cls: "orange" };
  if (s.status === "booked") return s.pickupStatus === "not_scheduled" ? { text: "Courier Assigned", cls: "navy" } : { text: "Scheduled", cls: "blue" };
  if (s.status === "pickup_pending") return { text: "Scheduled", cls: "blue" };
  return { text: "Picked Up", cls: "green" };
}

/** The one status an order shows — the same in the Customer Portal and in Admin. */
export function orderStatusText(r: StatusInput): { text: string; tone: string } {
  const s = r.shipment;
  if (s && s.bookingStatus === "confirmed" && s.status !== "booked") return { text: statusLabel(s.status), tone: STATUS_TONE[s.status] ?? "gray" };
  const b = bookingStage(r);
  return { text: b.text, tone: b.cls === "red" ? "red" : b.cls === "green" ? "green" : "amber" };
}
