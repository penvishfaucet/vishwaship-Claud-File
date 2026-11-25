"use client";
import { RateCalculator } from "@/components/public/RateCalculator";

/** The Customer Portal rate calculator, priced at courier cost + franchise margin, 4 rates first, City/State lookup. */
export function FranchiseCalculator() {
  return (
    <RateCalculator
      scope="public"
      layout="wide"
      endpoint="/api/franchise-rate-list/quote/"
      limit={4}
      pinLookup
      hidePartnerCode
      bookLabel="Book with this courier"
      bookHref={(o, f) => `/login/?next=${encodeURIComponent(`/portal/orders/new/?dest=${f.destination}&weight=${f.weightKg}&mode=${o.mode}`)}`}
    />
  );
}
