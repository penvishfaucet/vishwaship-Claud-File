import type { QuoteRequest } from "./types";

/**
 * A heavy (B2B-class) parcel can also go by the couriers of a Shipmozo B2C account (TCI Express, Blue Dart, Ekart,
 * Xpressbees, Amazon, Delhivery heavy … — what the Shipmozo panel lists) when that account can book it: one box, or
 * several once its multi-carton (MPS) booking is verified.
 */
export function shipmozoB2cTakesB2b(req: Pick<QuoteRequest, "packages">, cfg: Record<string, unknown>) {
  const boxes = req.packages.reduce((t, p) => t + p.count, 0);
  return boxes <= 1 || !!cfg.mpsBookingVerified;
}
