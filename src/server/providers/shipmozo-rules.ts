import type { QuoteRequest } from "./types";

/** A Shipmozo account can book this shipment's boxes: one box, or several once its multi-carton (MPS) booking is verified. */
export function shipmozoBooksBoxes(req: Pick<QuoteRequest, "packages">, cfg: Record<string, unknown>) {
  const boxes = req.packages.reduce((t, p) => t + p.count, 0);
  return boxes <= 1 || !!cfg.mpsBookingVerified;
}

/** Heaviest parcel a Shipmozo B2C account prices: its rate-calculator answers "weight must be ≤ 70000" above 70 kg. */
export const SHIPMOZO_B2C_MAX_GRAMS = 70_000;

/**
 * A heavy (B2B-class) parcel can also go by the couriers of a Shipmozo B2C account (TCI Express, Blue Dart, Ekart,
 * Xpressbees, Amazon, Delhivery heavy … — what the Shipmozo panel lists) when that account can book it: boxes it can
 * book, up to the B2C weight limit (heavier parcels go by the B2B account's LTL couriers instead).
 */
export function shipmozoB2cTakesB2b(req: Pick<QuoteRequest, "packages">, cfg: Record<string, unknown>) {
  const grams = req.packages.reduce((t, p) => t + p.actualWeightGrams * p.count, 0);
  const max = Number(cfg.maxWeightGrams) > 0 ? Number(cfg.maxWeightGrams) : SHIPMOZO_B2C_MAX_GRAMS;
  return shipmozoBooksBoxes(req, cfg) && grams <= max;
}
