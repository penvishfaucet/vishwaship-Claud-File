import { type PDFDocument, StandardFonts, rgb } from "pdf-lib";

/**
 * Our aggregator account's name as a courier prints it on its own label (client / pickup name), per integration.
 * Each occurrence is painted white and "VISHWASHIP" is written in its place; nothing else on the page changes.
 */
export const BRAND_TEXT: Record<string, string[]> = {
  delhivery_b2b: ["PENVISH B2B"],
};
export const BRAND_REPLACEMENT = "VISHWASHIP";

type Hit = { page: number; x: number; y: number; w: number; size: number };

/** Where `terms` appear in the PDF's text (PDF points, baseline). Widths of a part of a text run are estimated with Helvetica proportions. */
export async function findText(bytes: Uint8Array, terms: string[]): Promise<Hit[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: bytes.slice(), isEvalSupported: false, useSystemFonts: false, disableFontFace: true, verbosity: 0 });
  const pdf = await task.promise;
  const { PDFDocument: Doc } = await import("pdf-lib");
  const helv = await (await Doc.create()).embedFont(StandardFonts.Helvetica);
  const width = (s: string) => helv.widthOfTextAtSize(s, 10);
  const hits: Hit[] = [];
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      const items = (await (await pdf.getPage(i)).getTextContent()).items as Array<{ str?: string; transform: number[]; width: number; height: number }>;
      for (const it of items) {
        if (!it.str) continue;
        const [a, b, , d, e, f] = it.transform;
        if (Math.abs(b) > 0.01 || a <= 0) continue; // rotated text: left alone
        const full = width(it.str) || 1;
        for (const term of terms) {
          for (let at = it.str.indexOf(term); at >= 0; at = it.str.indexOf(term, at + term.length)) {
            hits.push({ page: i - 1, x: e + (it.width * width(it.str.slice(0, at))) / full, y: f, w: (it.width * width(term)) / full, size: Math.abs(d) || it.height || 8 });
          }
        }
      }
    }
  } finally { await task.destroy(); }
  return hits;
}

/** Replaces the courier-printed account name (BRAND_TEXT) with VISHWASHIP on every page. Returns how many were replaced. */
export async function replaceBrandText(doc: PDFDocument, provider: string, terms: string[] = BRAND_TEXT[provider] ?? []): Promise<number> {
  if (!terms.length) return 0;
  // read the text from a copy: saving the label itself here would freeze its content before we draw on it
  const hits = await findText(await (await doc.copy()).save(), terms);
  if (!hits.length) return 0;
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages = doc.getPages();
  for (const h of hits) {
    const page = pages[h.page];
    page.drawRectangle({ x: h.x - 0.6, y: h.y - h.size * 0.28, width: h.w + 1.2, height: h.size * 1.2, color: rgb(1, 1, 1) });
    const size = Math.min(h.size, (h.size * h.w) / Math.max(1, font.widthOfTextAtSize(BRAND_REPLACEMENT, h.size)));
    page.drawText(BRAND_REPLACEMENT, { x: h.x, y: h.y + (h.size - size) * 0.3, size, font, color: rgb(0, 0, 0) });
  }
  return hits.length;
}
