import { storeGuard } from "@/server/store/api";
import { pdfResponse, readIds } from "@/server/store/dispatch-http";
import { packingSlipsPdf } from "@/server/store/dispatch";

/** GET ?ids=a,b,c → one PDF of packing slips (read-only: printing a slip does not move the order). */
export async function GET(req: Request) {
  const g = await storeGuard(); if (g.err) return g.err;
  const ids = readIds(req); if (ids instanceof Response) return ids;
  return pdfResponse(await packingSlipsPdf(g.s.orgId, ids), "packing-slips");
}
