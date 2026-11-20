import { apiError } from "@/server/http";
import { rateLimit } from "@/server/security/rate-limit";
import { run, storeAudit, storeGuard } from "@/server/store/api";
import { SAMPLE_CSV, exportProductsCsv, planImport, runImport } from "@/server/store/catalog-io";

const csv = (body: string, name: string) => new Response(body, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" } });

/** GET ?sample=1 → sample file; otherwise export all products. */
export async function GET(req: Request) {
  const g = await storeGuard(); if (g.err) return g.err;
  if (new URL(req.url).searchParams.get("sample")) return csv(SAMPLE_CSV, "products-sample.csv");
  return csv(await exportProductsCsv(g.s.orgId), "products.csv");
}

/** POST ?mode=preview|import with the CSV file as the body (text/csv, max 2 MB). */
export async function POST(req: Request) {
  const g = await storeGuard(); if (g.err) return g.err;
  if (!(await rateLimit(`store-csv:${g.s.orgId}`, 30, 600)).ok) return apiError(429, "rate_limited", "Too many uploads. Try again in a few minutes.");
  if (Number(req.headers.get("content-length") ?? 0) > 2_000_000) return apiError(422, "validation_error", "File must be under 2 MB");
  const text = await req.text();
  if (text.length > 2_000_000) return apiError(422, "validation_error", "File must be under 2 MB");
  const mode = new URL(req.url).searchParams.get("mode") === "import" ? "import" : "preview";
  return run(async () => {
    if (mode === "preview") return { ok: true, ...(await planImport(g.s.orgId, text)).preview };
    const r = await runImport(g.s.orgId, text);
    await storeAudit(g.s, "product.import", undefined, r);
    return { ok: true, ...r };
  });
}
