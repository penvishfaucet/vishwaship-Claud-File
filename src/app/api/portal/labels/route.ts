import { apiCustomer } from "@/server/auth/session";
import { apiError } from "@/server/http";
import { labelResponse } from "@/server/labels/respond";
import { rateLimit } from "@/server/security/rate-limit";

/**
 * GET /api/portal/labels?ids=<shipmentId,...>&format=a4_1up|a4_fit|a4_doc|a4_2up|a4_4up|thermal_4x6|thermal_3x4|thermal_4x4|thermal_2x4|thermal_38x100|thermal_38x200|original
 * One PDF for this account's own shipments (another account's shipment is "Not found"). Shipments that could not be
 * included are listed in X-Label-Skipped (URI-encoded JSON with shipmentId + retryable) so only those are retried.
 * Read-only: never books, re-books or charges.
 */
export async function GET(req: Request) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const rl = await rateLimit(`labels:${s.orgId}`, 60, 300);
  if (!rl.ok) return apiError(429, "rate_limited", "Too many label downloads - try again in a few minutes");
  return labelResponse(s.orgId, new URL(req.url), { customerSafe: true });
}
