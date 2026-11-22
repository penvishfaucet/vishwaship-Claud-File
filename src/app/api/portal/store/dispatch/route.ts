import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson } from "@/server/http";
import { rateLimit } from "@/server/security/rate-limit";
import { fail, storeAudit, storeGuard } from "@/server/store/api";
import { packAndBook, shipmentsFor } from "@/server/store/dispatch";

/**
 * pack   → confirm packing, book a courier where needed (Auto-Assign / cheapest), return each order's result and the
 *          shipments whose labels can now be downloaded from /api/portal/labels.
 * labels → only look up the booked shipments of these orders (nothing is booked or charged).
 */
export async function POST(req: Request) {
  const g = await storeGuard(); if (g.err) return g.err;
  const p = await parseJson(req, z.object({ action: z.enum(["pack", "labels"]), ids: z.array(z.string().regex(/^[A-Za-z0-9_-]{4,64}$/)).min(1).max(100) })); if (!p.ok) return p.res;
  if (p.data.action === "labels") return NextResponse.json({ ok: true, shipmentIds: await shipmentsFor(g.s.orgId, p.data.ids) });
  if (!(await rateLimit(`store-pack:${g.s.orgId}`, 20, 300)).ok) return fail("Too many bookings at once. Please wait a few minutes.", 429);
  const results = await packAndBook(g.s.orgId, g.s.userId, p.data.ids);
  await storeAudit(g.s, "orders.pack_and_book", undefined, { booked: results.filter((r) => r.booked).map((r) => r.number), failed: results.filter((r) => !r.ok).map((r) => r.number) });
  return NextResponse.json({ ok: true, results, shipmentIds: results.filter((r) => r.ok && r.shipmentId).map((r) => r.shipmentId) });
}
