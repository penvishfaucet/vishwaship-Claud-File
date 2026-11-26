import { FranchiseRatePage } from "@/components/franchise-rates/FranchiseRatePage";

export const dynamic = "force-dynamic";

// Footer-only page (not in the header menu). Hidden from search so Google never shows partner prices
// next to the standard calculator; anyone with the link can open it.
export const metadata = {
  title: "Franchise Rate List — Vishwaship",
  description: "Shipping rate calculator and zone-wise rate list for franchise partners, bulk shippers, e-commerce, D2C and Shopify sellers.",
  robots: { index: false, follow: true },
};

export default function FranchiseRateListPage() {
  return <FranchiseRatePage />;
}
