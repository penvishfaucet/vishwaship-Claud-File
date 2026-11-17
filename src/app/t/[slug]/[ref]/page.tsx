import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { BuyerTracking } from "@/components/public/BuyerTracking";
import { t } from "@/server/content";
import { getDb, schema } from "@/server/db/client";
import { buyerShipmentByRef } from "@/server/tracking/buyer";
import { liveBranding } from "@/server/tracking/pages";

export const dynamic = "force-dynamic";
export const metadata = { title: "Track your order", robots: { index: false } };

/** Branded buyer tracking: /t/<store-slug>/<public-ref>. The ref must belong to that store. */
export default async function BrandedTracking({ params }: { params: Promise<{ slug: string; ref: string }> }) {
  const { slug, ref } = await params;
  const db = await getDb();
  const [page] = await db.select().from(schema.trackingPages).where(eq(schema.trackingPages.slug, slug));
  const found = await buyerShipmentByRef(ref);
  if (!page || !found || found.orgId !== page.orgId) notFound();
  return <BuyerTracking brand={await liveBranding(page.orgId)} shipment={found.shipment} footer={await t("public.tracking.footer")} />;
}
