import "server-only";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { buyerBranding } from "@/server/tracking/pages";
import { ensurePublicRef } from "@/server/tracking/service";

export type ShareInfo = {
  url: string; orderNumber: string; buyerMobile: string | null;
  /** What the buyer sees on the link: the seller's name and contact. */
  business: string; supportPhone: string; supportEmail: string;
};

/**
 * The buyer tracking link for one shipment (seller's branded page when published, else the plain link that
 * still shows the seller's name and contact) plus what the share message needs.
 */
export async function shareInfo(shipmentId: string): Promise<ShareInfo | null> {
  const db = await getDb();
  const [row] = await db.select({ orgId: schema.shipments.orgId, orderNumber: schema.orders.orderNumber, consignee: schema.orders.consignee })
    .from(schema.shipments).innerJoin(schema.orders, eq(schema.orders.id, schema.shipments.orderId)).where(eq(schema.shipments.id, shipmentId));
  if (!row) return null;
  const [page] = await db.select().from(schema.trackingPages).where(eq(schema.trackingPages.orgId, row.orgId));
  const ref = await ensurePublicRef(shipmentId);
  const base = (process.env.APP_URL ?? "").replace(/\/$/, "");
  const url = page?.isPublished && !page.disabledByAdmin ? `${base}/t/${page.slug}/${ref}` : `${base}/t/${ref}`;
  const brand = await buyerBranding(row.orgId);
  return {
    url, orderNumber: row.orderNumber, buyerMobile: (row.consignee as { mobile?: string } | null)?.mobile ?? null,
    business: brand?.businessName ?? "", supportPhone: brand?.supportPhone ?? "", supportEmail: brand?.supportEmail ?? "",
  };
}
