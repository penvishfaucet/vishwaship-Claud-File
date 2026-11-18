import { hideProviders } from "@/server/customer-safe";
import { NextResponse } from "next/server";
import { apiCustomer } from "@/server/auth/session";
import { apiError } from "@/server/http";
import { renderLabels } from "@/server/labels/render";
import { rateLimit } from "@/server/security/rate-limit";
import { type PrintFormat, PRINT_FORMATS } from "@/lib/order-view";

/**
 * GET /api/portal/labels?ids=<shipmentId,...>&format=thermal_3x4|thermal_4x4|thermal_2x4|thermal_38x100|original
 * One PDF (a page per label / box) for this account's own shipments. Shipments that cannot be
 * printed in that format are listed in the X-Label-Skipped header (URI-encoded JSON).
 */
export async function GET(req: Request) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const u = new URL(req.url);
  const format = u.searchParams.get("format") as PrintFormat | null;
  if (!format || !PRINT_FORMATS.some((p) => p.key === format)) return apiError(422, "validation_error", "Choose a label size");
  const ids = [...new Set((u.searchParams.get("ids") ?? "").split(",").map((x) => x.trim()).filter((x) => /^[A-Za-z0-9_-]{4,64}$/.test(x)))];
  if (!ids.length) return apiError(422, "validation_error", "Select at least one shipment");
  if (ids.length > 100) return apiError(422, "validation_error", "Download up to 100 labels at a time");
  const rl = await rateLimit(`labels:${s.orgId}`, 60, 300);
  if (!rl.ok) return apiError(429, "rate_limited", "Too many label downloads - try again in a few minutes");
  const r = await renderLabels(s.orgId, ids, format);
  r.skipped = r.skipped.map((x) => ({ ...x, reason: hideProviders(x.reason) }));
  if (!r.pdf) return NextResponse.json({ error: { code: "not_available", message: r.skipped.map((x) => `${x.orderNumber}: ${hideProviders(x.reason)}`).join("; ") || "No labels available" }, skipped: r.skipped }, { status: 422 });
  const name = ids.length === 1 ? `label-${ids[0]}` : `labels-${ids.length}`;
  return new Response(Buffer.from(r.pdf), {
    headers: {
      "content-type": "application/pdf", "content-disposition": `inline; filename="${name}-${format}.pdf"`, "cache-control": "private, no-store",
      "x-label-pages": String(r.pages), "x-label-skipped": encodeURIComponent(JSON.stringify(r.skipped)),
    },
  });
}
