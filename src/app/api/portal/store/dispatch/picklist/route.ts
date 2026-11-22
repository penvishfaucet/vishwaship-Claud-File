import { storeGuard } from "@/server/store/api";
import { pdfResponse, readIds } from "@/server/store/dispatch-http";
import { pickListPdf } from "@/server/store/dispatch";

/** GET ?ids=a,b,c → pick list PDF (total quantity per SKU / option, with the orders that need it). */
export async function GET(req: Request) {
  const g = await storeGuard(); if (g.err) return g.err;
  const ids = readIds(req); if (ids instanceof Response) return ids;
  return pdfResponse(await pickListPdf(g.s.orgId, ids), "pick-list");
}
