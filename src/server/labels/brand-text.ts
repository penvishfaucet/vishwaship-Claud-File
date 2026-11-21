import { type PDFDict, type PDFDocument, PDFArray, PDFName, PDFNumber, PDFRawStream, PDFRef, StandardFonts, decodePDFRawStream } from "pdf-lib";

/**
 * Our aggregator account's name as a courier prints it on its own label (client cell, return address), per integration.
 * Each occurrence is rewritten in the page's own text as "VISHWASHIP" (same place, same size, squeezed to the same
 * width), so the old name is gone from the PDF and nothing else on the page — barcodes, 2D codes, numbers — changes.
 */
export const BRAND_TEXT: Record<string, string[]> = {
  delhivery_b2b: ["PENVISH B2B"],
};
export const BRAND_REPLACEMENT = "VISHWASHIP";

type FontInfo = { two: boolean; toUni: Map<number, string>; widths: Map<number, number>; dw: number };

/** Code → text from a font's ToUnicode CMap (bfchar and bfrange). */
function parseToUnicode(cmap: string): Map<number, string> {
  const out = new Map<number, string>();
  const uni = (h: string) => String.fromCharCode(...(h.match(/.{4}/g) ?? []).map((x) => parseInt(x, 16)));
  for (const block of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) out.set(parseInt(m[1], 16), uni(m[2]));
  for (const block of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<([0-9a-fA-F]+)>|\[([^\]]*)\])/g)) {
      const lo = parseInt(m[1], 16), hi = parseInt(m[2], 16);
      if (m[4]) { const base = parseInt(m[4], 16); for (let c = lo; c <= hi; c++) out.set(c, String.fromCharCode(base + c - lo)); }
      else { const list = [...(m[5] ?? "").matchAll(/<([0-9a-fA-F]+)>/g)]; list.forEach((x, i) => out.set(lo + i, uni(x[1]))); }
    }
  }
  return out;
}

function fontInfo(doc: PDFDocument, font: PDFDict): FontInfo | null {
  const look = <T>(v: unknown) => (v instanceof PDFRef ? doc.context.lookup(v) : v) as T;
  const tu = look<PDFRawStream | undefined>(font.get(PDFName.of("ToUnicode")));
  const two = font.get(PDFName.of("Subtype"))?.toString() === "/Type0";
  // without a ToUnicode map only a simple (one-byte, Latin) font can be read: its codes are the characters
  if (!(tu instanceof PDFRawStream) && two) return null;
  const toUni = tu instanceof PDFRawStream ? parseToUnicode(Buffer.from(decodePDFRawStream(tu).decode()).toString("latin1")) : new Map(Array.from({ length: 95 }, (_, k) => [k + 32, String.fromCharCode(k + 32)] as [number, string]));
  const widths = new Map<number, number>();
  let dw = 1000;
  if (two) {
    const desc = look<PDFArray>(font.get(PDFName.of("DescendantFonts")));
    const cid = look<PDFDict>(desc?.get(0));
    const d = look<PDFNumber | undefined>(cid?.get(PDFName.of("DW")));
    if (d instanceof PDFNumber) dw = d.asNumber();
    const w = look<PDFArray | undefined>(cid?.get(PDFName.of("W")));
    const a = w ? w.asArray().map((x) => look<PDFNumber | PDFArray>(x)) : [];
    for (let i = 0; i < a.length;) {
      const first = (a[i] as PDFNumber).asNumber();
      const next = a[i + 1];
      if (next instanceof PDFArray) { next.asArray().forEach((x, k) => widths.set(first + k, (look<PDFNumber>(x)).asNumber())); i += 2; }
      else { const last = (next as PDFNumber).asNumber(), wd = (a[i + 2] as PDFNumber).asNumber(); for (let c = first; c <= last; c++) widths.set(c, wd); i += 3; }
    }
  } else {
    dw = 0;
    const fc = look<PDFNumber | undefined>(font.get(PDFName.of("FirstChar")));
    const w = look<PDFArray | undefined>(font.get(PDFName.of("Widths")));
    if (fc instanceof PDFNumber && w) w.asArray().forEach((x, k) => widths.set(fc.asNumber() + k, look<PDFNumber>(x).asNumber()));
  }
  return { two, toUni, widths, dw };
}

const hexOf = (codes: number[], two: boolean) => `<${codes.map((c) => c.toString(16).toUpperCase().padStart(two ? 4 : 2, "0")).join("")}>`;

/**
 * Rewrites the courier-printed account name (BRAND_TEXT) as VISHWASHIP on every page. Returns how many were replaced.
 * Works on the plain "<glyphs> Tj" text a courier's PDF generator writes (Delhivery labels come from Chromium).
 */
export async function replaceBrandText(doc: PDFDocument, provider: string, terms: string[] = BRAND_TEXT[provider] ?? []): Promise<number> {
  if (!terms.length) return 0;
  let count = 0;
  let vsFont: { name: PDFName; font: Awaited<ReturnType<PDFDocument["embedFont"]>> } | null = null;
  for (const page of doc.getPages()) {
    const fontsDict = page.node.Resources()?.lookup(PDFName.of("Font"));
    if (!fontsDict || !("get" in fontsDict)) continue;
    const contents = page.node.Contents();
    if (!contents) continue;
    const streams = (contents instanceof PDFArray ? contents.asArray().map((x) => doc.context.lookup(x)) : [contents]).filter((x): x is PDFRawStream => x instanceof PDFRawStream);
    let text = streams.map((st) => Buffer.from(decodePDFRawStream(st).decode()).toString("latin1")).join("\n");
    const infos = new Map<string, FontInfo | null>();
    const info = (name: string) => {
      if (!infos.has(name)) { const f = (fontsDict as PDFDict).lookup(PDFName.of(name.slice(1))); infos.set(name, f && "get" in f ? fontInfo(doc, f as PDFDict) : null); }
      return infos.get(name)!;
    };
    let changed = false, current = "", size = 0;
    const out: string[] = [];
    // tokens we care about: "/F 12 Tf" (font + size) and "<hex> Tj"; everything else is copied as is
    const re = /(\/[^\s/<>[\]()]+)\s+([-\d.]+)\s+Tf|<([0-9a-fA-F\s]*)>\s*Tj/g;
    let last = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      if (m[1]) { current = m[1]; size = Number(m[2]); continue; }
      const fi = current ? info(current) : null;
      if (!fi) continue;
      const hex = m[3].replace(/\s/g, "");
      const codes = (hex.match(fi.two ? /.{4}/g : /.{2}/g) ?? []).map((x) => parseInt(x, 16));
      const chars = codes.map((c) => fi.toUni.get(c) ?? "�");
      const str = chars.join("");
      const term = terms.find((t) => str.includes(t));
      if (!term) continue;
      if (!vsFont) { const font = await doc.embedFont(StandardFonts.HelveticaBold); vsFont = { font, name: PDFName.of("VSBrand") }; }
      (fontsDict as PDFDict).set(vsFont.name, vsFont.font.ref);
      // split the run into glyph pieces around each occurrence (one char per code for these fonts)
      const parts: string[] = [];
      let i = 0;
      while (i < codes.length) {
        const at = str.indexOf(term, i);
        if (at < 0) { parts.push(`${hexOf(codes.slice(i), fi.two)} Tj`); break; }
        if (at > i) parts.push(`${hexOf(codes.slice(i, at), fi.two)} Tj`);
        const oldW = codes.slice(at, at + term.length).reduce((t, c) => t + (fi.widths.get(c) ?? fi.dw), 0) * size / 1000;
        const newW = vsFont.font.widthOfTextAtSize(BRAND_REPLACEMENT, size);
        const tz = oldW > 0 ? Math.min(100, (100 * oldW) / newW) : 100;
        parts.push(`/VSBrand ${size} Tf ${tz.toFixed(2)} Tz (${BRAND_REPLACEMENT}) Tj 100 Tz ${current} ${size} Tf`);
        if (tz === 100 && oldW > newW) parts.push(`[${(-((oldW - newW) * 1000) / size).toFixed(1)}] TJ`); // keep what follows where it was
        i = at + term.length;
        count++;
      }
      out.push(text.slice(last, m.index), parts.join(" "));
      last = m.index + m[0].length;
      changed = true;
    }
    if (!changed) continue;
    out.push(text.slice(last));
    text = out.join("");
    const ref = doc.context.register(doc.context.flateStream(Buffer.from(text, "latin1")));
    page.node.set(PDFName.of("Contents"), ref);
  }
  return count;
}
