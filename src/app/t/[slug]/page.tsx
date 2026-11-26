import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { and, eq, or } from "drizzle-orm";
import { BuyerTracking } from "@/components/public/BuyerTracking";
import { EmbedResize } from "@/components/public/EmbedResize";
import { t } from "@/server/content";
import { getDb, schema } from "@/server/db/client";
import { rateLimit, ipFromHeaders } from "@/server/security/rate-limit";
import { buyerShipmentByRef } from "@/server/tracking/buyer";
import { buyerBranding, liveBranding } from "@/server/tracking/pages";
import { ensurePublicRef } from "@/server/tracking/service";

export const dynamic = "force-dynamic";
export const metadata = { title: "Track your order", robots: { index: false } };

/**
 * Two uses:
 *  /t/<public-ref>        → generic Vishwaship tracking of one shipment (ref starts with "t").
 *  /t/<store-slug>?q=…    → a store's branded search page; buyers enter AWB or order ID.
 */
export default async function TrackingEntry({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ q?: string }> }) {
  const { slug } = await params;
  const { q } = await searchParams;
  const footer = await t("public.tracking.footer");
  const byRef = await buyerShipmentByRef(slug);
  if (byRef) return <><EmbedResize /><BuyerTracking brand={await buyerBranding(byRef.orgId)} shipment={byRef.shipment} footer={footer} /></>;

  const db = await getDb();
  const [page] = await db.select().from(schema.trackingPages).where(eq(schema.trackingPages.slug, slug));
  if (!page || !page.isPublished || page.disabledByAdmin) notFound();
  const brand = await liveBranding(page.orgId);
  if (!brand) notFound();
  let notFoundMsg = false, limited = false;
  if (q?.trim()) {
    const h = await headers();
    const rl = await rateLimit(`ptrack:${slug}:${ipFromHeaders(h)}`, 20, 600);
    if (!rl.ok) limited = true;
    else {
      const v = q.trim();
      const [hit] = await db.select({ id: schema.shipments.id }).from(schema.shipments).innerJoin(schema.orders, eq(schema.orders.id, schema.shipments.orderId))
        .where(and(eq(schema.shipments.orgId, page.orgId), or(eq(schema.shipments.awb, v.toUpperCase()), eq(schema.orders.orderNumber, v)))).limit(1);
      if (hit) redirect(`/t/${slug}/${await ensurePublicRef(hit.id)}`);
      notFoundMsg = true;
    }
  }
  return (
    <>
    <EmbedResize />
    <BuyerTracking brand={brand} shipment={null} footer={footer}>
      <form style={{ display: "flex", gap: 8, margin: "8px 0 12px" }} role="search">
        <label htmlFor="bq" className="sr-only">AWB or order ID</label>
        <input id="bq" name="q" defaultValue={q} required placeholder="Enter AWB or order ID" className="input" style={{ flex: 1 }} />
        <button className="btn" style={{ background: brand.accentColor, color: "#fff", border: 0 }}>Track</button>
      </form>
      {(notFoundMsg || limited) && <p role="status" style={{ color: "#c62828", margin: "0 0 12px" }}>{limited ? "Too many searches. Please try again in a few minutes." : "We couldn’t find that order. Check the AWB or order ID."}</p>}
    </BuyerTracking>
    </>
  );
}
