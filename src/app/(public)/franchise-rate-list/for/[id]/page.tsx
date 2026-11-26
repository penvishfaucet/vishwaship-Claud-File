import { notFound } from "next/navigation";
import { FranchiseRatePage } from "@/components/franchise-rates/FranchiseRatePage";
import { getRateLink } from "@/server/franchise-rates/links";

export const dynamic = "force-dynamic";

/** Personal Franchise Rate List link for one firm (Admin → Franchise Rate List → Personal links). Never indexed. */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const link = await getRateLink((await params).id);
  return {
    title: link ? `Rates for ${link.firm} — Vishwaship` : "Franchise Rate List — Vishwaship",
    description: link ? `Shipping rates estimation designed for ${link.firm}.` : undefined,
    robots: { index: false, follow: false },
  };
}

export default async function PersonalRatePage({ params }: { params: Promise<{ id: string }> }) {
  const link = await getRateLink((await params).id);
  if (!link) notFound();
  return <FranchiseRatePage link={link} />;
}
