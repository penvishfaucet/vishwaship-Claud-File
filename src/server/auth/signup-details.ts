/**
 * Does this customer still owe the sign-up details (mobile, business, parcels per day) on /welcome/?
 * - No mobile at all → yes (we cannot call them back), for every account, old or new.
 * - New Google / mobile-OTP accounts → yes until they give parcels per day (their profile is not complete yet).
 * Existing customers with a mobile and a completed profile are never stopped.
 */
export function needsSignupDetails(
  u: { mobile: string | null },
  o: { dailyParcels: string | null; profileCompletedAt: Date | null },
) {
  if (!u.mobile) return true;
  return !o.dailyParcels && !o.profileCompletedAt;
}
