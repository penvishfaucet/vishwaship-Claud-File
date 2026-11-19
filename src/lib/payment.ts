/**
 * Payment on an order: who pays the freight (Prepaid = the shipper, FOD = the receiver, B2B only) and, separately,
 * whether the courier also collects Cash on Delivery for the goods.
 * Stored as paymentType "prepaid" | "cod" | "fod" + codAmountPaise:
 *   prepaid + COD  → paymentType "cod", codAmountPaise > 0
 *   FOD + COD      → paymentType "fod", codAmountPaise > 0  (Delhivery B2B only)
 */
export type PaymentType = "prepaid" | "cod" | "fod";

/** True when the courier collects a COD amount from the receiver (plain COD or FOD + COD). */
export const collectsCod = (paymentType: string, codPaise?: number | null) => paymentType === "cod" || (paymentType === "fod" && (codPaise ?? 0) > 0);

/** Short label: Prepaid, COD, FOD, FOD + COD. */
export const paymentLabel = (paymentType: string, codPaise?: number | null) =>
  paymentType === "fod" ? ((codPaise ?? 0) > 0 ? "FOD + COD" : "FOD") : paymentType === "cod" ? "COD" : "Prepaid";

/** From the form: freight payer + "Cash on Delivery available" switch → stored payment type. */
export const paymentTypeOf = (freight: "prepaid" | "fod", cod: boolean): PaymentType => (freight === "fod" ? "fod" : cod ? "cod" : "prepaid");

/** Couriers that can collect COD on a FOD shipment (Shipmozo does not). */
export const FOD_COD_ADAPTERS = ["delhivery_b2b", "demo"];
