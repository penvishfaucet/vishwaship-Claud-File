/**
 * Sign-up details every new customer gives (owner 2026-11-28): mobile, name, business name and parcels per day,
 * so the Vishwaship team can call back. Shared by the sign-up form, /welcome/ and the server checks.
 */
export const DAILY_PARCELS = [
  "Just starting (0 – 1)",
  "1 – 10 parcels",
  "10 – 50 parcels",
  "50 – 200 parcels",
  "200+ parcels",
] as const;

export const isDailyParcels = (v: string): v is (typeof DAILY_PARCELS)[number] => (DAILY_PARCELS as readonly string[]).includes(v);

/** Indian mobile → 10 digits (drops +91 / 0), or null when it is not a valid Indian mobile number. */
export function indianMobile(raw: string): string | null {
  const d = String(raw ?? "").replace(/\D/g, "").replace(/^(91|0)(?=[6-9]\d{9}$)/, "");
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}
