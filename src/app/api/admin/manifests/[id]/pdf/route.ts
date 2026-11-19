import { apiStaff } from "@/server/auth/session";
import { apiError } from "@/server/http";
import { findManifest, servePdf } from "@/server/manifests/files";

/** Staff (shipments.read): original manifest PDF of any customer, e.g. for a missed-pickup complaint. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiStaff("shipments.read");
  if (!s) return apiError(403, "forbidden", "Not allowed");
  const m = await findManifest((await params).id, null);
  return m ? servePdf(m) : apiError(404, "not_found", "Manifest not found");
}
