import { apiStaff } from "@/server/auth/session";
import { apiError } from "@/server/http";
import { labelResponse } from "@/server/labels/respond";
import { rateLimit } from "@/server/security/rate-limit";

/** GET /api/admin/labels?ids=…&format=… — Admin download of any account's labels (staff with shipments.read). Read-only. */
export async function GET(req: Request) {
  const s = await apiStaff("shipments.read");
  if (!s) return apiError(403, "forbidden", "You don't have permission to download labels");
  const rl = await rateLimit(`labels:staff:${s.userId}`, 120, 300);
  if (!rl.ok) return apiError(429, "rate_limited", "Too many label downloads - try again in a few minutes");
  return labelResponse(null, new URL(req.url), { customerSafe: false });
}
