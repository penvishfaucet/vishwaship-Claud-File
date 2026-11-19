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

/** FOD is offered only for parcels heavier than this (chargeable weight: actual or volumetric, whichever is higher). */
export const FOD_MIN_KG = 15;
export const FOD_RULE_TEXT = `Only available for parcels over ${FOD_MIN_KG} kg`;
/** Chargeable kg of a set of boxes (volumetric = L×B×H cm ÷ 5000), the same figure the Create Order form shows. */
export function chargeableKg(boxes: Array<{ count: number; lengthCm: number; breadthCm: number; heightCm: number; weightKg: number }>) {
  const actual = boxes.reduce((t, b) => t + b.count * b.weightKg, 0);
  const vol = boxes.reduce((t, b) => t + b.count * ((b.lengthCm * b.breadthCm * b.heightCm) / 5000), 0);
  return Math.max(actual, vol);
}
export const fodAllowed = (kg: number) => kg > FOD_MIN_KG;
