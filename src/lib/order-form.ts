/**
 * Create Order: invoice maths, E-Way Bill threshold, package types and box limits.
 * Shared by the form (live totals) and the server (the saved order uses the server's numbers).
 * All money is in paise (integers) so frontend and backend round identically.
 */

export const EWAY_THRESHOLD_PAISE = 50_000_00; // ₹50,000 — the field opens only ABOVE this
export const MULTIBOX_MAX_CM = 306;
export const SINGLE_MAX_CM = 500;

export const PACKAGE_TYPES = [
  { key: "parcel", label: "Parcel (below 10 kg)", mode: "B2C" as const, minChargeKg: 0.5, rov: false },
  { key: "heavy", label: "Heavy Shipment (10 kg or above) (Single or Multiple boxes)", mode: "B2B" as const, minChargeKg: 20, rov: true },
] as const;
export type PackageTypeKey = (typeof PACKAGE_TYPES)[number]["key"];
export const ROV_TYPES = [{ key: "owner", label: "ROV Owner (owner's risk)" }, { key: "carrier", label: "ROV Carrier (carrier's risk)" }] as const;

export type InvoiceLine = { qty: number; unitPricePaise: number; discountPaise?: number; taxBps?: number };

/** One product line: qty × unit price − discount (never below 0), plus tax % on the discounted amount. */
export function lineTotal(l: InvoiceLine) {
  const gross = Math.max(0, Math.round(l.qty) * Math.round(l.unitPricePaise));
  const net = Math.max(0, gross - Math.max(0, Math.round(l.discountPaise ?? 0)));
  const tax = Math.round((net * Math.max(0, l.taxBps ?? 0)) / 10_000);
  return { gross, net, tax, total: net + tax };
}

/** Grand total = Σ line totals + shipping charges. This is the final invoice value. */
export function invoiceTotals(lines: InvoiceLine[], shippingPaise = 0) {
  const rows = lines.map(lineTotal);
  const products = rows.reduce((t, r) => t + r.total, 0);
  const shipping = Math.max(0, Math.round(shippingPaise));
  return { rows, products, shipping, grandTotal: products + shipping };
}

/** E-Way Bill field: enabled only when the final invoice value is above ₹50,000. */
export const ewayEnabled = (grandTotalPaise: number) => grandTotalPaise > EWAY_THRESHOLD_PAISE;

/** Rupees text → paise (accepts "1,234.50"); NaN-safe. */
export function toPaise(v: string | number | undefined | null) {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[,₹\s]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export type BoxGroup = { count: number; weightKg: number; lengthCm: number; breadthCm: number; heightCm: number };
/** Actual order weight = Σ boxes × weight per box (kg, 3 decimals). */
export const totalWeightKg = (groups: BoxGroup[]) => Math.round(groups.reduce((t, g) => t + (g.count > 0 && g.weightKg > 0 ? g.count * g.weightKg : 0), 0) * 1000) / 1000;
/** Per-dimension limit: 306 cm whenever more than one box ships, 500 cm for a single box. */
export const dimensionLimitCm = (groups: BoxGroup[]) => (groups.reduce((t, g) => t + (g.count > 0 ? g.count : 0), 0) > 1 ? MULTIBOX_MAX_CM : SINGLE_MAX_CM);
