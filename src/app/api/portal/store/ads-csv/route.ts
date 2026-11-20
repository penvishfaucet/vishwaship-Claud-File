import { apiError } from "@/server/http";
import { rateLimit } from "@/server/security/rate-limit";
import { run, storeAudit, storeGuard } from "@/server/store/api";
import { importGoogleAdsCsv } from "@/server/store/analytics";

/** Upload a Google Ads daily report (CSV text in the body). Same days are replaced, not doubled. */
export async function POST(req: Request) {
  const g = await storeGuard(); if (g.err) return g.err;
  if (!(await rateLimit(`store-adscsv:${g.s.orgId}`, 20, 3600)).ok) return apiError(429, "rate_limited", "Too many uploads. Try again later.");
  if (Number(req.headers.get("content-length") ?? 0) > 3_000_000) return apiError(422, "validation_error", "File must be under 3 MB");
  const text = await req.text();
  return run(async () => { const r = await importGoogleAdsCsv(g.s.orgId, text); await storeAudit(g.s, "ads.google_csv", undefined, r); return { ok: true, ...r }; });
}
