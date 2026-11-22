import "server-only";
import { apiError } from "@/server/http";

/** `?ids=a,b,c` → up to 200 safe ids, or a 422 response. */
export function readIds(req: Request): string[] | Response {
  const ids = [...new Set((new URL(req.url).searchParams.get("ids") ?? "").split(",").map((x) => x.trim()).filter((x) => /^[A-Za-z0-9_-]{4,64}$/.test(x)))];
  if (!ids.length) return apiError(422, "validation_error", "Select at least one order");
  if (ids.length > 200) return apiError(422, "validation_error", "Select up to 200 orders at a time");
  return ids;
}

/** Inline PDF (opens in the phone's viewer; Download / Share from there), or a clear error. */
export function pdfResponse(r: { pdf: Uint8Array; count: number } | null, name: string) {
  if (!r) return apiError(422, "validation_error", "None of these orders can be packed (accept them first)");
  const stamp = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 16).replace(/[-:T]/g, "");
  return new Response(Buffer.from(r.pdf), {
    headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${name}-${r.count}-${stamp}.pdf"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
  });
}
