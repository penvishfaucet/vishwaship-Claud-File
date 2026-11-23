import { apiCustomer } from "@/server/auth/session";
import { apiError } from "@/server/http";
import { podFilesForOrg } from "@/server/tracking/pod";
import { zip } from "@/server/zip";

/** Customer: ZIP of the available PODs for the selected shipments (?ids=a,b — up to 200, own account only). */
export async function GET(req: Request) {
  const s = await apiCustomer();
  if (!s) return apiError(401, "unauthorized", "Please log in");
  const ids = (new URL(req.url).searchParams.get("ids") ?? "").split(",").map((x) => x.trim()).filter((x) => /^[A-Za-z0-9_-]{1,64}$/.test(x));
  if (!ids.length) return apiError(400, "validation_error", "Choose at least one shipment");
  const files = await podFilesForOrg(s.orgId, [...new Set(ids)]);
  if (!files.length) return apiError(404, "not_found", "None of the selected shipments has a Proof of Delivery yet");
  return new Response(new Uint8Array(zip(files)), { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="POD-${new Date().toISOString().slice(0, 10)}.zip"`, "cache-control": "private, no-store" } });
}
