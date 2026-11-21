import { z } from "zod";
import { apiError, parseJson } from "@/server/http";
import { rateLimit } from "@/server/security/rate-limit";
import { run, storeGuard } from "@/server/store/api";
import { buyPlan } from "@/server/store/billing";

/** Buy (or renew) a store plan from the wallet. The idempotency key makes a double click charge once. */
export async function POST(req: Request) {
  const g = await storeGuard(); if (g.err) return g.err;
  if (g.s.impersonatorId) return apiError(403, "forbidden", "Only the merchant can spend from their wallet");
  if (!(await rateLimit(`store-plan:${g.s.orgId}`, 10, 600)).ok) return apiError(429, "rate_limited", "Too many attempts. Try again in a few minutes.");
  const p = await parseJson(req, z.object({ planId: z.string().max(60), idem: z.string().min(8).max(80) })); if (!p.ok) return p.res;
  return run(async () => {
    const r = await buyPlan(g.s.orgId, { userId: g.s.userId, kind: "customer" }, p.data.planId, p.data.idem);
    return { ok: true, id: r.sub.id, until: r.sub.periodEnd.toISOString(), receipt: r.sub.receiptNumber, replayed: r.replayed };
  });
}
