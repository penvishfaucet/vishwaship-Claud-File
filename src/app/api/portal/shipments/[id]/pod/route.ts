import { apiCustomer } from "@/server/auth/session";
import { apiError } from "@/server/http";
import { podResponse } from "@/server/tracking/pod-http";

/** Customer: Proof of Delivery of one of their own shipments (?part=signature, ?download=1). Other accounts' → 404. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const { id } = await params;
  const r = await podResponse(id, s.orgId, new URL(req.url));
  return r ?? apiError(404, "not_found", "Proof of Delivery is not available for this shipment");
}
