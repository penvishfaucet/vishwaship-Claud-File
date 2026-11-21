import { type PDFDocument, rgb } from "pdf-lib";
import { VISHWASHIP_LOGO } from "./logos.generated";

/** A part of a label page, as fractions of the page measured from its top-left corner. */
export type Region = { x: number; y: number; w: number; h: number };

/**
 * Where another company's branding sits on a courier's own label. Each region is painted white and the Vishwaship
 * logo is placed inside it; nothing else on the page (barcodes, codes, addresses) is touched.
 * Courier brands themselves (Delhivery, etc.) stay: only the aggregator's own logo is covered.
 */
export const BRAND_COVER: Record<string, Region[]> = {
  // Shipmozo's 4 × 6 / A6 label: the account logo box at the top right of the "Ship To" block (measured on a real
  // label: logo image at x 0.604, top 0.120, 0.355 × 0.056 of the page; the box is a little larger but stops short of the right border line). The barcodes
  // (AWB from top 0.326, order id from 0.487) and the address text (left of x 0.57) are outside it.
  shipmozo: [{ x: 0.595, y: 0.105, w: 0.368, h: 0.085 }],
};

/** Covers the branding regions on every page of `doc` (a courier's label) and puts the Vishwaship logo there. */
export async function coverBranding(doc: PDFDocument, provider: string, regions: Region[] = BRAND_COVER[provider] ?? []): Promise<number> {
  if (!regions.length) return 0;
  const logo = await doc.embedPng(Buffer.from(VISHWASHIP_LOGO.mono, "base64"));
  let n = 0;
  for (const page of doc.getPages()) {
    const W = page.getWidth(), H = page.getHeight();
    for (const r of regions) {
      const x = r.x * W, w = r.w * W, h = r.h * H, y = H - (r.y * H) - h;
      page.drawRectangle({ x, y, width: w, height: h, color: rgb(1, 1, 1) });
      // the logo fits inside the covered area with a small margin, keeping its proportions
      const pad = Math.min(w, h) * 0.08;
      const s = Math.min((w - 2 * pad) / logo.width, (h - 2 * pad) / logo.height);
      const lw = logo.width * s, lh = logo.height * s;
      page.drawImage(logo, { x: x + (w - lw) / 2, y: y + (h - lh) / 2, width: lw, height: lh });
      n++;
    }
  }
  return n;
}
