import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, parseJson } from "@/server/http";
import { rateLimit } from "@/server/security/rate-limit";
import { fail, storeAudit, storeGuard } from "@/server/store/api";
import { disconnectMeta, metaAuthUrl, selectMetaAssets, syncMetaInsights } from "@/server/store/meta-connect";
import { markStep } from "@/server/store/service";

/** GET → start "Connect with Facebook" (redirect to Meta). */
export async function GET(req: Request) {
  const g = await storeGuard(); if (g.err) return g.err;
  const url = metaAuthUrl(g.s.orgId);
  const back = new URL("/portal/store/marketing/", req.url);
  if (!url) { back.searchParams.set("err", "Facebook connection is not switched on yet. Vishwaship needs to finish its Meta app setup."); return NextResponse.redirect(back); }
  return NextResponse.redirect(url);
}

/** PATCH → choose business / page / ad account (each is read live before it counts as connected). */
export async function PATCH(req: Request) {
  const g = await storeGuard(); if (g.err) return g.err;
  const p = await parseJson(req, z.object({ businessId: z.string().max(40).optional(), pageId: z.string().max(40).optional(), adAccountId: z.string().max(40).optional() })); if (!p.ok) return p.res;
  const r = await selectMetaAssets(g.s.orgId, g.s.userId, p.data);
  await storeAudit(g.s, "meta.select", undefined, { ...p.data, ok: r.ok });
  if (r.ok) await markStep(g.s.orgId, 6);
  return r.ok ? NextResponse.json(r) : fail(r.message);
}

/** POST → sync ad results now. */
export async function POST() {
  const g = await storeGuard(); if (g.err) return g.err;
  if (!(await rateLimit(`store-meta-sync:${g.s.orgId}`, 6, 3600)).ok) return apiError(429, "rate_limited", "You can sync a few times an hour. Results also update daily by themselves.");
  const r = await syncMetaInsights(g.s.orgId, 30);
  return r.ok ? NextResponse.json(r) : fail(r.message);
}

export async function DELETE() {
  const g = await storeGuard(); if (g.err) return g.err;
  await disconnectMeta(g.s.orgId);
  await storeAudit(g.s, "meta.disconnect");
  return NextResponse.json({ ok: true });
}
