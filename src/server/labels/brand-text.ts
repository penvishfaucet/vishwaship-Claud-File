import { type PDFDict, type PDFDocument, PDFArray, PDFName, PDFNumber, PDFRawStream, PDFRef, StandardFonts, decodePDFRawStream } from "pdf-lib";

/**
 * Our aggregator account's name as a courier prints it on its own label (client cell, return address), per integration.
 * Each occurrence is rewritten in the page's own text as "VISHWASHIP" (same place, same size, squeezed to the same
 * width), so the old name is gone from the PDF and nothing else on the page — barcodes, 2D codes, numbers — changes.
 */
export const BRAND_TEXT: Record<string, string[]> = {
  delhivery_b2b: ["PENVISH B2B"],
  // the aggregator account name Shipmozo prints on the Delhivery B2B labels it books (routing box, return address)
  shipmozo: ["SHIPMOZO B2BC", "SHIPMOZO B2B", "SHIPMOZO"],
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

/** A term as a pattern: any run of spaces / tabs between its words, any letter case. */
const termPattern = (terms: string[]) => new RegExp([...terms].sort((a, b) => b.length - a.length).map((t) => t.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s\\u00a0]+")).join("|"), "gi");

/**
 * Rewrites the courier-printed account name (BRAND_TEXT) as VISHWASHIP on every page. Returns how many were replaced.
 * Works on "<glyphs> Tj" text, whether a word is one run (Chromium-made Delhivery labels) or one run per letter, each
 * placed with its own Td (the labels Shipmozo makes for Delhivery B2B).
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
    const text = streams.map((st) => Buffer.from(decodePDFRawStream(st).decode()).toString("latin1")).join("\n");
    const infos = new Map<string, FontInfo | null>();
    const info = (name: string) => {
      if (!infos.has(name)) { const f = (fontsDict as PDFDict).lookup(PDFName.of(name.slice(1))); infos.set(name, f && "get" in f ? fontInfo(doc, f as PDFDict) : null); }
      return infos.get(name)!;
    };
    // every "<hex> Tj" with its font, size and characters; text blocks (BT … ET) keep runs from joining across blocks
    type Run = { start: number; end: number; font: string; size: number; fi: FontInfo; codes: number[]; chars: string[]; block: number };
    const runs: Run[] = [];
    let current = "", size = 0, block = 0;
    const re = /(\/[^\s/<>[\]()]+)\s+([-\d.]+)\s+Tf|<([0-9a-fA-F\s]*)>\s*Tj|\b(BT|ET)\b/g;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      if (m[1]) { current = m[1]; size = Number(m[2]); continue; }
      if (m[4]) { block++; continue; }
      const fi = current ? info(current) : null;
      if (!fi) { block++; continue; } // unreadable text breaks a word
      const hex = (m[3] ?? "").replace(/\s/g, "");
      const codes = (hex.match(fi.two ? /.{4}/g : /.{2}/g) ?? []).map((x) => parseInt(x, 16));
      runs.push({ start: m.index, end: m.index + m[0].length, font: current, size, fi, codes, chars: codes.map((c) => fi.toUni.get(c) ?? "�"), block });
    }
    // what replaces each run: the glyphs it keeps, with VISHWASHIP put in where a term starts
    const edits = new Map<Run, string>();
    const addVs = async (r: Run, oldW: number) => {
      if (!vsFont) { const font = await doc.embedFont(StandardFonts.HelveticaBold); vsFont = { font, name: PDFName.of("VSBrand") }; }
      (fontsDict as PDFDict).set(vsFont.name, vsFont.font.ref);
      const newW = vsFont.font.widthOfTextAtSize(BRAND_REPLACEMENT, r.size);
      const tz = oldW > 0 ? Math.min(100, (100 * oldW) / newW) : 100;
      let s = `/VSBrand ${r.size} Tf ${tz.toFixed(2)} Tz (${BRAND_REPLACEMENT}) Tj 100 Tz ${r.font} ${r.size} Tf`;
      if (tz === 100 && oldW > newW) s += ` [${(-((oldW - newW) * 1000) / r.size).toFixed(1)}] TJ`; // keep what follows where it was
      return s;
    };
    for (let i = 0; i < runs.length;) {
      // one text block's runs, read as one string (per-letter runs become words again)
      let j = i;
      while (j < runs.length && runs[j].block === runs[i].block) j++;
      const group = runs.slice(i, j);
      const owner: Array<[Run, number]> = [];
      for (const r of group) r.chars.forEach((_, k) => owner.push([r, k]));
      const str = group.map((r) => r.chars.join("")).join("");
      const hits = [...str.matchAll(termPattern(terms))].filter((h) => h[0].length);
      if (hits.length) {
        // per run: which of its glyphs stay, and where VISHWASHIP goes
        const keep = new Map<Run, boolean[]>(group.map((r) => [r, r.codes.map(() => true)]));
        const insertAt = new Map<Run, Array<{ at: number; w: number }>>();
        for (const h of hits) {
          const from = h.index!, to = from + h[0].length;
          let w = 0;
          for (let k = from; k < to; k++) { const [r, g] = owner[k]; keep.get(r)![g] = false; w += ((r.fi.widths.get(r.codes[g]) ?? r.fi.dw) * r.size) / 1000; }
          const [r0, g0] = owner[from];
          insertAt.set(r0, [...(insertAt.get(r0) ?? []), { at: g0, w }]);
          count++;
        }
        for (const r of group) {
          const k = keep.get(r)!, ins = insertAt.get(r) ?? [];
          if (k.every(Boolean)) continue;
          const parts: string[] = [];
          let buf: number[] = [];
          const flush = () => { if (buf.length) { parts.push(`${hexOf(buf, r.fi.two)} Tj`); buf = []; } };
          for (let g = 0; g < r.codes.length; g++) {
            const vs = ins.find((x) => x.at === g);
            if (vs) { flush(); parts.push(await addVs(r, vs.w)); }
            if (k[g]) buf.push(r.codes[g]); else flush();
          }
          flush();
          edits.set(r, parts.join(" "));
        }
      }
      i = j;
    }
    if (!edits.size) continue;
    const out: string[] = [];
    let last = 0;
    for (const r of runs) {
      const e = edits.get(r);
      if (e === undefined) continue;
      out.push(text.slice(last, r.start), e);
      last = r.end;
    }
    out.push(text.slice(last));
    const ref = doc.context.register(doc.context.flateStream(Buffer.from(out.join(""), "latin1")));
    page.node.set(PDFName.of("Contents"), ref);
  }
  return count;
}
