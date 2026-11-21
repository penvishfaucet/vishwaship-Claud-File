import "server-only";
import { NextResponse } from "next/server";
import { hideProviders } from "@/server/customer-safe";
import { type PrintFormat, PRINT_FORMATS, PRINT_HINT } from "@/lib/order-view";
import { renderLabels } from "./render";
import { normalizeLabelFormat } from "./formats";

/** Shared by the customer and Admin label downloads: validate, render, answer with a PDF (or a clear JSON error). */
export async function labelResponse(orgId: string | null, url: URL, opts: { customerSafe: boolean }) {
  const asked = url.searchParams.get("format");
  // two sizes now (A4 · 4 per sheet, thermal 4 × 6) plus the courier's own label; older choices map to the nearest
  const format: PrintFormat | null = asked && PRINT_FORMATS.some((p) => p.key === asked) ? normalizeLabelFormat(asked) : null;
  if (!format) return NextResponse.json({ error: { code: "validation_error", message: "Choose a label format" } }, { status: 422 });
  const ids = [...new Set((url.searchParams.get("ids") ?? "").split(",").map((x) => x.trim()).filter((x) => /^[A-Za-z0-9_-]{4,64}$/.test(x)))];
  if (!ids.length) return NextResponse.json({ error: { code: "validation_error", message: "Select at least one shipment" } }, { status: 422 });
  if (ids.length > 100) return NextResponse.json({ error: { code: "validation_error", message: "Download up to 100 labels at a time" } }, { status: 422 });
  let r: Awaited<ReturnType<typeof renderLabels>>;
  try { r = await renderLabels(orgId, ids, format); }
  catch (e) {
    console.error("label download failed", ids.join(","), format, e);
    return NextResponse.json({ error: { code: "label_error", message: "Could not prepare the labels just now — please try again. If it keeps failing, contact Vishwaship support." }, skipped: [], notices: [], retryable: true }, { status: 500 });
  }
  const clean = (s: string) => (opts.customerSafe ? hideProviders(s) : s);
  const skipped = r.skipped.map((x) => ({ ...x, reason: clean(x.reason) }));
  const notices = r.notices.map(clean);
  if (!r.pdf) {
    const retryable = skipped.some((x) => x.retryable);
    return NextResponse.json({ error: { code: retryable ? "label_pending" : "not_available", message: skipped.map((x) => `${x.orderNumber}: ${x.reason}`).join("; ") || "No labels available" }, skipped, notices, retryable }, { status: retryable ? 409 : 422 });
  }
  const f = PRINT_FORMATS.find((p) => p.key === format)!;
  const name = (ids.length === 1 ? `label-${ids[0]}` : `labels-${ids.length}`) + `-${format}.pdf`;
  return new Response(Buffer.from(r.pdf), {
    headers: {
      "content-type": "application/pdf", "content-disposition": `inline; filename="${name}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff",
      "x-label-pages": String(r.pages), "x-label-format": encodeURIComponent(f.name), "x-label-hint": encodeURIComponent(PRINT_HINT),
      "x-label-skipped": encodeURIComponent(JSON.stringify(skipped)), "x-label-notices": encodeURIComponent(JSON.stringify(notices)),
      "access-control-expose-headers": "x-label-pages, x-label-format, x-label-hint, x-label-skipped, x-label-notices",
    },
  });
}
