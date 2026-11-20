import { NextResponse } from "next/server";
import { and, eq, or } from "drizzle-orm";
import { getDb, schema } from "@/server/db/client";
import { clientIp, rateLimit } from "@/server/security/rate-limit";
import { buyerShipmentByRef } from "@/server/tracking/buyer";
import { liveBranding } from "@/server/tracking/pages";
import { ensurePublicRef } from "@/server/tracking/service";
import { statusLabel } from "@/lib/status";
import { hasFeature } from "@/server/features";
import { TrackingPageSettings, defaultTrackingSettings } from "@/lib/tracking-page";

/**
 * Data for the tracking widget a client embeds on their own website (public/track-embed.js).
 * The widget draws the tracker inside the client's page, so no iframe (and no frame headers) is involved.
 * Returns only the store's published branding and buyer-safe shipment fields (never addresses, phones or prices).
 * GET /api/public/track-widget/?store=<slug>[&q=<AWB or order ID>]
 */
const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, OPTIONS", "cache-control": "no-store" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: CORS });

export function OPTIONS() { return new NextResponse(null, { status: 204, headers: CORS }); }

export async function GET(req: Request) {
  const u = new URL(req.url);
  const slug = (u.searchParams.get("store") ?? "").trim().toLowerCase();
  const q = (u.searchParams.get("q") ?? "").trim().slice(0, 40);
  if (!/^[a-z0-9-]{1,60}$/.test(slug)) return json({ error: "unknown_store" }, 404);
  const db = await getDb();
  const [page] = await db.select().from(schema.trackingPages).where(eq(schema.trackingPages.slug, slug));
  if (!page || page.disabledByAdmin) return json({ error: "unknown_store" }, 404);
  // published branding when there is one; otherwise the saved draft (or defaults), so the widget works before Publish
  let brand = page.isPublished ? await liveBranding(page.orgId) : null;
  if (!brand) {
    if (!(await hasFeature(page.orgId, "branded_tracking"))) return json({ error: "unknown_store" }, 404);
    const [org] = await db.select({ name: schema.orgs.businessName }).from(schema.orgs).where(eq(schema.orgs.id, page.orgId));
    const d = TrackingPageSettings.safeParse(page.draft);
    brand = d.success ? d.data : defaultTrackingSettings(org?.name ?? "Your store");
  }
  const out: Record<string, unknown> = {
    brand: { businessName: brand.businessName, logo: brand.logo, primaryColor: brand.primaryColor, accentColor: brand.accentColor, headline: brand.headline, message: brand.message,
      supportEmail: brand.supportEmail, supportPhone: brand.supportPhone, supportHours: brand.supportHours, showCarrier: brand.showCarrier, footerText: brand.footerText },
    shipment: null,
  };
  if (q) {
    if (!(await rateLimit(`twidget:${slug}:${clientIp(req)}`, 30, 600)).ok) return json({ ...out, error: "rate_limited" }, 429);
    const [hit] = await db.select({ id: schema.shipments.id }).from(schema.shipments).innerJoin(schema.orders, eq(schema.orders.id, schema.shipments.orderId))
      .where(and(eq(schema.shipments.orgId, page.orgId), or(eq(schema.shipments.awb, q.toUpperCase()), eq(schema.orders.orderNumber, q)))).limit(1);
    if (!hit) return json({ ...out, error: "not_found" });
    const found = await buyerShipmentByRef(await ensurePublicRef(hit.id));
    if (found) {
      const s = found.shipment;
      // events already carry readable labels (toBuyerEvents)
      out.shipment = { orderNumber: s.orderNumber, awb: s.awb, carrierName: brand.showCarrier ? s.carrierName : null, status: s.status, statusLabel: statusLabel(s.status), etaDate: s.etaDate, events: s.events, checkedAt: new Date().toISOString() };
    }
  }
  return json(out);
}
