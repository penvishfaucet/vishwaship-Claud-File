import { NextResponse } from "next/server";
import { z } from "zod";
import { audit } from "@/server/audit";
import { apiCustomer } from "@/server/auth/session";
import { apiError, parseJson } from "@/server/http";
import { ManifestError, generateManifest, listManifests } from "@/server/manifests/service";
import { rateLimit } from "@/server/security/rate-limit";

/** Manifest History of this account. */
export async function GET() {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const rows = await listManifests(s.orgId);
  return NextResponse.json({ manifests: rows.map((m) => ({ id: m.id, manifestNo: m.manifestNo, scope: m.scope, bookingDate: m.bookingDate, awbCount: m.awbCount, boxCount: m.boxCount, createdAt: m.createdAt, signed: !!m.signedCopy })) });
}

/**
 * Generate a manifest — always a new Manifest ID; earlier manifests stay in history.
 * { date: "YYYY-MM-DD", carrierCode?, warehouseId? } → daily manifest (all eligible shipments of that IST day)
 * { shipmentId }                                       → one shipment
 * Reads only: shipment / pickup statuses are untouched.
 */
export async function POST(req: Request) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const p = await parseJson(req, z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), shipmentId: z.string().regex(/^[A-Za-z0-9_-]{4,64}$/).optional(),
    carrierCode: z.string().trim().max(60).optional().or(z.literal("")), warehouseId: z.string().trim().max(64).optional().or(z.literal("")),
  }));
  if (!p.ok) return p.res;
  if (!(await rateLimit(`manifest:${s.orgId}`, 30, 300)).ok) return apiError(429, "rate_limited", "Too many manifests at once — try again in a few minutes");
  try {
    const r = await generateManifest({ orgId: s.orgId, userId: s.userId, scope: p.data.shipmentId ? "shipment" : "daily", date: p.data.date, shipmentId: p.data.shipmentId, carrierCode: p.data.carrierCode || undefined, warehouseId: p.data.warehouseId || undefined });
    await audit({ actorUserId: s.userId, actorKind: s.impersonatorId ? "staff" : "customer", orgId: s.orgId, action: "manifest.generate", targetType: "manifest", targetId: r.id, details: { manifestNo: r.manifestNo, awbs: r.awbCount } });
    return NextResponse.json({ ...r, pdfUrl: `/api/portal/manifests/${r.id}/pdf` }, { status: 201 });
  } catch (e) {
    if (e instanceof ManifestError) return apiError(e.status, e.status === 404 ? "not_found" : e.status === 409 ? "conflict" : "validation_error", e.message);
    throw e;
  }
}
