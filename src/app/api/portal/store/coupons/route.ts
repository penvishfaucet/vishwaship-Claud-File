import { z } from "zod";
import { parseJson } from "@/server/http";
import { run, storeAudit, storeGuard } from "@/server/store/api";
import { CouponInput, saveCoupon } from "@/server/store/catalog-io";

/** Create (no id) or update a coupon. */
export async function POST(req: Request) {
  const g = await storeGuard(); if (g.err) return g.err;
  const p = await parseJson(req, z.object({ id: z.string().max(60).optional(), coupon: CouponInput })); if (!p.ok) return p.res;
  return run(async () => {
    const id = await saveCoupon(g.s.orgId, p.data.coupon, p.data.id);
    await storeAudit(g.s, p.data.id ? "coupon.update" : "coupon.create", id, { code: p.data.coupon.code });
    return { ok: true, id };
  });
}
