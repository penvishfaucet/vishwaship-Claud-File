import { apiCustomer } from "@/server/auth/session";
import { apiError } from "@/server/http";
import { findManifest, servePdf } from "@/server/manifests/files";

/** The original manifest PDF, exactly as generated (own account only). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const m = await findManifest((await params).id, s.orgId);
  return m ? servePdf(m) : apiError(404, "not_found", "Manifest not found");
}
