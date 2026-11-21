import { z } from "zod";
import { parseJson } from "@/server/http";
import { run, storeAudit, storeGuard } from "@/server/store/api";
import { moderateReview } from "@/server/store/reviews";

/** Hide, show again or delete a buyer review. */
export async function POST(req: Request) {
  const g = await storeGuard(); if (g.err) return g.err;
  const p = await parseJson(req, z.object({ id: z.string().max(60), action: z.enum(["hide", "show", "delete"]) })); if (!p.ok) return p.res;
  return run(async () => { await moderateReview(g.s.orgId, p.data.id, p.data.action); await storeAudit(g.s, `review.${p.data.action}`, p.data.id); return { ok: true }; });
}
