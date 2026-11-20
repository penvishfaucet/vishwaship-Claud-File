import { NextResponse } from "next/server";
import { and, eq, or } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/server/db/client";
import { clientIp, rateLimit } from "@/server/security/rate-limit";
import { newId } from "@/server/util/ids";

/**
 * A buyer asks the store for help from the tracking widget ("Raise a request").
 * The request reaches the store as an alert in their Vishwaship portal (and the app's push); it needs a real
 * AWB / order ID of that store, so the form can't be used to spam a store with made-up requests.
 * POST /api/public/track-widget/request/  {store, ref, name, phone, topic, message}
 */
const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type", "cache-control": "no-store" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: CORS });
export function OPTIONS() { return new NextResponse(null, { status: 204, headers: CORS }); }

const TOPICS = { where: "Where is my order?", delay: "Delivery is late", address: "Change address / phone", reattempt: "Deliver again", damaged: "Damaged / wrong item", return: "Return or exchange", other: "Other" } as const;
const Body = z.object({
  store: z.string().regex(/^[a-z0-9-]{1,60}$/),
  ref: z.string().trim().min(3).max(40),
  name: z.string().trim().min(2).max(60),
  phone: z.string().trim().regex(/^[+0-9 ()-]{8,18}$/),
  topic: z.enum(Object.keys(TOPICS) as [keyof typeof TOPICS, ...(keyof typeof TOPICS)[]]),
  message: z.string().trim().max(400).default(""),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid" }, 400);
  const b = parsed.data;
  if (!(await rateLimit(`twreq:${b.store}:${clientIp(req)}`, 5, 3600)).ok) return json({ error: "rate_limited" }, 429);
  const db = await getDb();
  const [page] = await db.select({ orgId: schema.trackingPages.orgId, off: schema.trackingPages.disabledByAdmin }).from(schema.trackingPages).where(eq(schema.trackingPages.slug, b.store));
  if (!page || page.off) return json({ error: "unknown_store" }, 404);
  const [hit] = await db.select({ id: schema.shipments.id, awb: schema.shipments.awb, order: schema.orders.orderNumber }).from(schema.shipments).innerJoin(schema.orders, eq(schema.orders.id, schema.shipments.orderId))
    .where(and(eq(schema.shipments.orgId, page.orgId), or(eq(schema.shipments.awb, b.ref.toUpperCase()), eq(schema.orders.orderNumber, b.ref)))).limit(1);
  if (!hit) return json({ error: "not_found" }, 404);
  const clean = (s: string) => s.replace(/\s+/g, " ");
  const title = `Buyer request · ${TOPICS[b.topic]} · #${hit.order}${hit.awb ? ` (AWB ${hit.awb})` : ""} · ${clean(b.name)}, ${clean(b.phone)}${b.message ? ` — “${clean(b.message)}”` : ""}`.slice(0, 600);
  await db.insert(schema.inAppAlerts).values({ id: newId("al"), orgId: page.orgId, kind: "buyer_request", title, href: `/portal/orders/?q=${encodeURIComponent(hit.awb ?? hit.order)}` });
  return json({ ok: true, topic: TOPICS[b.topic], order: hit.order });
}
