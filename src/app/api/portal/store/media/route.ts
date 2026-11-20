import { apiError } from "@/server/http";
import { rateLimit } from "@/server/security/rate-limit";
import { run, storeGuard } from "@/server/store/api";
import { MEDIA_MAX_BYTES, uploadMedia } from "@/server/store/catalog";

/** Upload one store image (multipart field "file"). Type is checked from the file bytes, not the name. */
export async function POST(req: Request) {
  const g = await storeGuard(); if (g.err) return g.err;
  if (!(await rateLimit(`store-media:${g.s.orgId}`, 120, 3600)).ok) return apiError(429, "rate_limited", "Too many uploads. Try again later.");
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MEDIA_MAX_BYTES + 50_000) return apiError(422, "validation_error", "Image must be under 1.5 MB");
  let file: File | null = null;
  try { const fd = await req.formData(); const f = fd.get("file"); file = f instanceof File ? f : null; } catch { /* handled below */ }
  if (!file) return apiError(422, "validation_error", "Choose an image");
  const buf = Buffer.from(await file.arrayBuffer());
  return run(async () => { const id = await uploadMedia(g.s.orgId, buf); return { ok: true, id, url: `/api/store-media/${id}/` }; });
}
