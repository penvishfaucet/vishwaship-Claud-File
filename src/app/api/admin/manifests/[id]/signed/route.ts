import { apiStaff } from "@/server/auth/session";
import { apiError } from "@/server/http";
import { findManifest, serveSigned } from "@/server/manifests/files";

/** Staff (shipments.read): the customer's signed copy of a manifest. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiStaff("shipments.read");
  if (!s) return apiError(403, "forbidden", "Not allowed");
  const m = await findManifest((await params).id, null);
  return m ? serveSigned(m) : apiError(404, "not_found", "Manifest not found");
}
