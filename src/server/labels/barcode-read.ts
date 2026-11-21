/**
 * Reads the barcodes printed on a courier's own label image, so the Vishwaship label can carry exactly the same
 * numbers (same Code 128 data) — and finds the 2D code (Delhivery's DataMatrix) so it can be copied pixel for pixel.
 * Pure TypeScript on RGBA pixels: no native libraries.
 */

const C128 = ["212222","222122","222221","121223","121322","131222","122213","122312","132212","221213","221312","231212","112232","122132","122231","113222","123122","123221","223211","221132","221231","213212","223112","312131","311222","321122","321221","312212","322112","322211","212123","212321","232121","111323","131123","131321","112313","132113","132311","211313","231113","231311","112133","112331","132131","113123","113321","133121","313121","211331","231131","213113","213311","213131","311123","311321","331121","312113","312311","332111","314111","221411","431111","111224","111422","121124","121421","141122","141221","112214","112412","122114","122411","142112","142211","241211","221114","413111","241112","134111","111242","121142","121241","114212","124112","124211","411212","421112","421211","212141","214121","412121","111143","111341","131141","114113","114311","411113","411311","113141","114131","311141","411131","211412","211214","211232"];
const LOOKUP = new Map(C128.map((p, i) => [p, i]));
const STOP = "2331112";

export type ReadBarcode = { text: string; x0: number; x1: number; y0: number; y1: number };
export type Rect = { x: number; y: number; w: number; h: number };

/** Dark/light map of an RGBA image (transparent pixels count as white paper). */
export function darkMap(rgba: Uint8Array, width: number, height: number, threshold = 128): Uint8Array {
  const dark = new Uint8Array(width * height);
  for (let p = 0; p < dark.length; p++) {
    const a = rgba[p * 4 + 3] / 255;
    const g = (rgba[p * 4] * 0.299 + rgba[p * 4 + 1] * 0.587 + rgba[p * 4 + 2] * 0.114) * a + 255 * (1 - a);
    dark[p] = g < threshold ? 1 : 0;
  }
  return dark;
}

/** Element widths (in modules) of `count` runs starting at `i`, normalised to `modules` in total; null if they do not add up. */
function norm(runs: number[], i: number, count: number, modules: number): string | null {
  if (i + count > runs.length) return null;
  let sum = 0;
  for (let k = 0; k < count; k++) sum += runs[i + k];
  const m = sum / modules;
  if (m < 0.8) return null; // narrower than a pixel per module: not readable
  let s = "", total = 0;
  for (let k = 0; k < count; k++) { const w = Math.max(1, Math.min(4, Math.round(runs[i + k] / m))); s += w; total += w; }
  return total === modules ? s : null;
}

/** Data characters from Code 128 symbol values (sets A, B and C, with shift); null if malformed. */
function decodeValues(values: number[]): string | null {
  let set: "A" | "B" | "C" = values[0] === 103 ? "A" : values[0] === 104 ? "B" : "C";
  let out = "", shift = false;
  for (let i = 1; i < values.length; i++) {
    const v = values[i];
    const cur = shift ? (set === "A" ? "B" : "A") : set;
    shift = false;
    if (cur === "C") {
      if (v < 100) out += String(v).padStart(2, "0");
      else if (v === 100) set = "B"; else if (v === 101) set = "A"; else if (v === 102) { /* FNC1 */ } else return null;
      continue;
    }
    if (v < 96) { const c = cur === "A" ? (v < 64 ? v + 32 : v - 64) : v + 32; if (c < 32 || c > 126) return null; out += String.fromCharCode(c); continue; }
    if (v === 98) { shift = true; continue; }
    if (v === 99) { set = "C"; continue; }
    if ((cur === "A" && v === 100) || (cur === "B" && v === 101)) { set = cur === "A" ? "B" : "A"; continue; }
    if (v === 100 || v === 101 || v === 102 || v === 96 || v === 97) continue; // FNC codes
    return null;
  }
  return out;
}

/** All Code 128 symbols readable on one row of the image. */
function readRow(dark: Uint8Array, width: number, y: number): Array<{ text: string; x0: number; x1: number }> {
  const runs: number[] = [], starts: number[] = [];
  let x = 0;
  while (x < width && !dark[y * width + x]) x++;
  while (x < width) {
    const c = dark[y * width + x];
    let l = 0;
    while (x + l < width && dark[y * width + x + l] === c) l++;
    runs.push(l); starts.push(x);
    x += l;
  }
  // runs alternate dark / light starting with dark (index 0, 2, …)
  const found: Array<{ text: string; x0: number; x1: number }> = [];
  for (let i = 0; i + 6 <= runs.length; i += 2) {
    const start = norm(runs, i, 6, 11);
    if (!start || !["211412", "211214", "211232"].includes(start)) continue;
    // a quiet zone of light before the start (at least ~5 modules)
    const mod = runs.slice(i, i + 6).reduce((a, b) => a + b, 0) / 11;
    if (i > 0 && runs[i - 1] < mod * 5) continue;
    const values = [LOOKUP.get(start)!];
    let j = i + 6, ok = false;
    while (j + 7 <= runs.length + 1) {
      const stop = norm(runs, j, 7, 13);
      if (stop === STOP) { ok = true; break; }
      const sym = norm(runs, j, 6, 11);
      const v = sym ? LOOKUP.get(sym) : undefined;
      if (v === undefined) break;
      values.push(v);
      j += 6;
    }
    if (!ok || values.length < 3) continue;
    const check = values.pop()!;
    const sum = values.reduce((s, v, k) => s + v * (k === 0 ? 1 : k), 0) % 103;
    if (sum !== check) continue;
    const text = decodeValues(values);
    if (!text) continue;
    found.push({ text, x0: starts[i], x1: starts[j + 6] + runs[j + 6] });
    i = j + 6; // continue after this symbol's stop
  }
  return found;
}

/**
 * Every Code 128 barcode on the image, read on many rows: a value counts only when at least 3 rows agree and no other
 * value is read in the same place (a damaged read is never reported). Sorted top to bottom.
 */
export function readCode128(rgba: Uint8Array, width: number, height: number): ReadBarcode[] {
  const dark = darkMap(rgba, width, height);
  const clusters: Array<ReadBarcode & { rows: number }> = [];
  for (let y = 0; y < height; y++) {
    for (const r of readRow(dark, width, y)) {
      const c = clusters.find((k) => k.text === r.text && y - k.y1 <= 3 && r.x0 < k.x1 && k.x0 < r.x1);
      if (c) { c.y1 = y; c.rows++; c.x0 = Math.min(c.x0, r.x0); c.x1 = Math.max(c.x1, r.x1); }
      else clusters.push({ text: r.text, x0: r.x0, x1: r.x1, y0: y, y1: y, rows: 1 });
    }
  }
  const good = clusters.filter((c) => c.rows >= 3);
  // two different values read over the same bars means a misread: drop both
  const clash = (a: ReadBarcode, b: ReadBarcode) => a.text !== b.text && a.x0 < b.x1 && b.x0 < a.x1 && a.y0 <= b.y1 + 2 && b.y0 <= a.y1 + 2;
  const ok = good.filter((a) => !good.some((b) => clash(a, b))).sort((a, b) => a.y0 - b.y0);
  const uniq = new Map<string, ReadBarcode>();
  for (const c of ok) if (!uniq.has(c.text)) uniq.set(c.text, { text: c.text, x0: c.x0, x1: c.x1, y0: c.y0, y1: c.y1 });
  return [...uniq.values()];
}

/**
 * The 2D code on a label (Delhivery's DataMatrix): a roughly square block of dark modules, about half filled,
 * standing apart from the table lines. Returns its box with a small white margin, or null.
 */
export function find2DCode(rgba: Uint8Array, width: number, height: number, avoid: Rect[] = []): Rect | null {
  const dark = darkMap(rgba, width, height);
  const seen = new Uint8Array(width * height);
  let best: (Rect & { fill: number }) | null = null;
  const stack: number[] = [];
  for (let p0 = 0; p0 < dark.length; p0++) {
    if (!dark[p0] || seen[p0]) continue;
    let x0 = width, y0 = height, x1 = 0, y1 = 0, n = 0;
    stack.push(p0); seen[p0] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % width, y = (p / width) | 0;
      n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      for (const q of [p - 1, p + 1, p - width, p + width]) {
        if (q < 0 || q >= dark.length || seen[q] || !dark[q]) continue;
        if ((q === p - 1 && x === 0) || (q === p + 1 && x === width - 1)) continue;
        seen[q] = 1; stack.push(q);
      }
    }
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    if (w < 24 || h < 24 || w > width * 0.6 || h > height * 0.6) continue;
    const ratio = w / h, fill = n / (w * h);
    if (ratio < 0.8 || ratio > 1.25 || fill < 0.3 || fill > 0.75) continue;
    if (avoid.some((a) => x0 < a.x + a.w && a.x < x1 && y0 < a.y + a.h && a.y < y1)) continue;
    if (!best || w * h > best.w * best.h) best = { x: x0, y: y0, w, h, fill };
  }
  if (!best) return null;
  const m = Math.max(2, Math.round(best.w * 0.06));
  const x = Math.max(0, best.x - m), y = Math.max(0, best.y - m);
  return { x, y, w: Math.min(width - x, best.w + 2 * m), h: Math.min(height - y, best.h + 2 * m) };
}

/** RGBA pixels of a part of an image (for copying the 2D code). */
export function crop(rgba: Uint8Array, width: number, r: Rect): Uint8Array {
  const out = new Uint8Array(r.w * r.h * 4);
  for (let y = 0; y < r.h; y++) out.set(rgba.subarray(((r.y + y) * width + r.x) * 4, ((r.y + y) * width + r.x + r.w) * 4), y * r.w * 4);
  return out;
}

/** What a courier's label page carries: its barcodes (read) and its 2D code (as dark-pixel runs, to redraw exactly). */
export type PageScan = { codes: ReadBarcode[]; matrix: { w: number; h: number; runs: Array<[number, number, number]> } | null };

/** Reads one label image: every Code 128 value and the 2D code (as runs of dark pixels per row). */
export function scanLabelImage(rgba: Uint8Array, width: number, height: number): PageScan {
  const codes = readCode128(rgba, width, height);
  const r = find2DCode(rgba, width, height, codes.map((c) => ({ x: c.x0, y: c.y0, w: c.x1 - c.x0, h: c.y1 - c.y0 + 1 })));
  let matrix: PageScan["matrix"] = null;
  if (r) {
    const dark = darkMap(rgba, width, height);
    const runs: Array<[number, number, number]> = [];
    for (let y = 0; y < r.h; y++) {
      let x = 0;
      while (x < r.w) {
        if (!dark[(r.y + y) * width + r.x + x]) { x++; continue; }
        let l = 0; while (x + l < r.w && dark[(r.y + y) * width + r.x + x + l]) l++;
        runs.push([x, y, l]); x += l;
      }
    }
    matrix = { w: r.w, h: r.h, runs };
  }
  return { codes, matrix };
}

/** Merges the scans of several images on one page (a PDF page with separate barcode images). */
export function mergeScans(list: PageScan[]): PageScan {
  const codes: ReadBarcode[] = [];
  for (const s of list) for (const c of s.codes) if (!codes.some((x) => x.text === c.text)) codes.push(c);
  const matrix = list.map((s) => s.matrix).filter((m): m is NonNullable<PageScan["matrix"]> => !!m).sort((a, b) => b.w * b.h - a.w * a.h)[0] ?? null;
  return { codes, matrix };
}
