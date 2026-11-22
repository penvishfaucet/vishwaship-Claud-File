import { NextResponse } from "next/server";
import { z } from "zod";
import { parseJson } from "@/server/http";
import { rateLimit } from "@/server/security/rate-limit";
import { fail, storeAudit, storeGuard } from "@/server/store/api";
import { packAndBook, shipmentsFor } from "@/server/store/dispatch";
import { markHandedOver, markLabelsPrinted, markPacked } from "@/server/store/process";

const Id = z.string().regex(/^[A-Za-z0-9_-]{4,64}$/);

/**
 * print       → book a courier where needed (Auto-Assign / cheapest) and hand back the shipments whose labels can be
 *               downloaded from /api/portal/labels; those orders move on to Pack.
 * pack        → older one-step flow: mark packed + book + labels.
 * labels      → only look up booked shipments (reprint; nothing is booked or charged).
 * mark_packed → Pack step done (only orders whose label exists).
 * handover    → handed to the courier.
 */
export async function POST(req: Request) {
  const g = await storeGuard(); if (g.err) return g.err;
  const p = await parseJson(req, z.object({ action: z.enum(["print", "pack", "labels", "mark_packed", "handover"]), ids: z.array(Id).min(1).max(100),
    /** COD orders the merchant chose to ship without the buyer's WhatsApp confirmation. */
    shipWithoutCodConfirmation: z.array(Id).max(100).default([]) })); if (!p.ok) return p.res;
  const { action, ids } = p.data;
  if (action === "labels") return NextResponse.json({ ok: true, shipmentIds: await shipmentsFor(g.s.orgId, ids) });
  if (action === "mark_packed") { const r = await markPacked(g.s.orgId, g.s.userId, ids); await storeAudit(g.s, "orders.packed", undefined, r); return NextResponse.json({ ok: true, ...r }); }
  if (action === "handover") { const r = await markHandedOver(g.s.orgId, g.s.userId, ids); await storeAudit(g.s, "orders.handed_over", undefined, r); return NextResponse.json({ ok: true, ...r }); }
  if (!(await rateLimit(`store-pack:${g.s.orgId}`, 20, 300)).ok) return fail("Too many bookings at once. Please wait a few minutes.", 429);
  const results = await packAndBook(g.s.orgId, g.s.userId, ids, { shipWithoutCodConfirmation: p.data.shipWithoutCodConfirmation, markPacked: action === "pack" });
  const done = results.filter((r) => r.ok && r.shipmentId);
  await markLabelsPrinted(g.s.orgId, done.map((r) => r.id));
  await storeAudit(g.s, action === "print" ? "orders.print_labels" : "orders.pack_and_book", undefined, { booked: results.filter((r) => r.booked).map((r) => r.number), failed: results.filter((r) => !r.ok).map((r) => r.number),
    shippedWithoutCodConfirmation: results.filter((r) => r.ok && p.data.shipWithoutCodConfirmation.includes(r.id)).map((r) => r.number) });
  return NextResponse.json({ ok: true, results, shipmentIds: done.map((r) => r.shipmentId) });
}
