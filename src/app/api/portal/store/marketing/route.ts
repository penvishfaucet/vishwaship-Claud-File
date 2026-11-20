import { NextResponse } from "next/server";
import { apiError, parseJson } from "@/server/http";
import { rateLimit } from "@/server/security/rate-limit";
import { storeAudit, storeGuard } from "@/server/store/api";
import { MarketingInput, checkMarketing, saveMarketing } from "@/server/store/marketing";
import { markStep } from "@/server/store/service";

/** Save pixel / tag ids and server-event secrets (blank secrets keep the stored ones), then check them live. */
export async function PUT(req: Request) {
  const g = await storeGuard(); if (g.err) return g.err;
  if (!(await rateLimit(`store-mkt:${g.s.orgId}`, 30, 600)).ok) return apiError(429, "rate_limited", "Too many attempts. Try again in a few minutes.");
  const p = await parseJson(req, MarketingInput); if (!p.ok) return p.res;
  const r = await saveMarketing(g.s.orgId, g.s.userId, p.data);
  await storeAudit(g.s, "marketing.save", undefined, { meta: !!p.data.meta.pixelId, ga4: !!p.data.ga4.measurementId, gads: !!p.data.gads.conversionId, codMilestone: p.data.codMilestone });
  if (p.data.meta.pixelId || p.data.ga4.measurementId || p.data.gads.conversionId) await markStep(g.s.orgId, 6);
  return NextResponse.json({ ok: true, overview: r });
}

export async function POST() {
  const g = await storeGuard(); if (g.err) return g.err;
  if (!(await rateLimit(`store-mkt:${g.s.orgId}`, 30, 600)).ok) return apiError(429, "rate_limited", "Too many attempts. Try again in a few minutes.");
  return NextResponse.json({ ok: true, overview: await checkMarketing(g.s.orgId, g.s.userId) });
}
