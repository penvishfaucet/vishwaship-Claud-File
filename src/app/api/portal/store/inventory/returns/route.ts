import { z } from "zod";
import { parseJson } from "@/server/http";
import { run, storeAudit, storeGuard } from "@/server/store/api";
import { InspectInput, inspectReturn } from "@/server/store/inventory";

/** Count a returned order once: sellable back on sale, damaged set aside, missing recorded. */
export async function POST(req: Request) {
  const g = await storeGuard(); if (g.err) return g.err;
  const p = await parseJson(req, InspectInput.extend({ orderId: z.string().max(60) })); if (!p.ok) return p.res;
  return run(async () => {
    const r = await inspectReturn(g.s.orgId, g.s.userId, p.data.orderId, p.data);
    await storeAudit(g.s, "stock.return_counted", p.data.orderId, r);
    return r;
  });
}
