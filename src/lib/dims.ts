/** Box size units a customer can type in. Everything we store, quote and send to couriers is in cm. */
export type DimUnit = "cm" | "in" | "ft";
export const DIM_UNITS: Array<{ id: DimUnit; label: string; short: string }> = [
  { id: "cm", label: "Centimetre", short: "cm" },
  { id: "in", label: "Inch", short: "inch" },
  { id: "ft", label: "Feet", short: "ft" },
];
const CM_PER: Record<DimUnit, number> = { cm: 1, in: 2.54, ft: 30.48 };
const DP: Record<DimUnit, number> = { cm: 1, in: 2, ft: 3 };
const round = (v: number, dp: number) => Math.round(v * 10 ** dp) / 10 ** dp;

/** A length typed in `unit` → cm, to the nearest mm (0.1 cm). Bad input → 0. */
export function toCm(value: string | number, unit: DimUnit): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? round(n * CM_PER[unit], 1) : 0;
}

/** A length in cm → `unit`, rounded for display. */
export function fromCm(cm: number, unit: DimUnit): number {
  return round(cm / CM_PER[unit], DP[unit]);
}

/** Re-express a typed length from one unit in another (empty stays empty). */
export function convertDim(value: string, from: DimUnit, to: DimUnit): string {
  if (from === to || value.trim() === "") return value;
  const cm = toCm(value, from);
  return cm > 0 ? String(fromCm(cm, to)) : value;
}
