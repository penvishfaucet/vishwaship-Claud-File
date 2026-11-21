import * as UPNGns from "@pdf-lib/upng";

const UPNG = ((UPNGns as unknown as { default?: typeof UPNGns }).default ?? UPNGns) as typeof UPNGns;

/**
 * Our aggregator account's name as it appears, as pixels, in a courier's label IMAGES ("PENVISH B2B" on Delhivery
 * B2B labels: the client cell / "Client:" line and the return address). Patterns were read off Delhivery's own label
 * images (A4, 3 × 4, 4 × 4 and 2 × 4 renders): "#" = dark pixel, "." = light. `bold` picks the font written in its place.
 */
type Pattern = { rows: string[]; bold: boolean };
const PATTERNS: Record<string, Pattern[]> = {
  delhivery_b2b: [
    { bold: true, rows: [ // A4: client cell
      "######..######.##...####....#.##..####...#...##.....#####...####..#####..",
      "##..##..##.....###..##.##..##.##.##..##..#...##.....##..##.##.##..##..##.",
      "##...##.#......###..##.##..##.##.##......#...##.....#...##.....#..#...##.",
      "##..##..#......####.##.##..#..##..####...######.....#####.....##..#####..",
      "######..#####..##.#.##..#.##..##...####..##..##.....##..##...##...##..##.",
      "##......##.....##.####..####..##......#..#...##.....#....##.##....#....##",
      "##......##.....##..###..###...##.##..##..#...##.....##..##.###....##..##.",
      "##......######.##..###...##...##..####...#...##.....######.######.######."] },
    { bold: false, rows: [ // A4: return address
      "####...#####.#....#.#....#.#...###...#...#.....####...##...#",
      "#...#..#.....##...#.#....#.#..#...#..#...#.....#..#..#..#..#",
      "#...#..#.....#.#..#.#...#..#..#......#...#.....#..#.....#..#",
      "#...#..#.....#.#..#..#..#..#..###....#####.....####.....#..#",
      "####...####..#..#.#..#..#..#.....##..#...#.....#...#...#...#",
      "#......#.....#..#.#..#.#...#......#..#...#.....#...#..#....#",
      "#......#.....#...##...##...#..#...#..#...#.....#...#.#.....#",
      "#......#####.#...##...##...#..####...#...#.....####..####..#"] },
    { bold: true, rows: [ // 3 × 4 / 4 × 4: "Client:" line
      "#####..#####..##..####...####..####..#...##....#####...###..#####.",
      "##..##.##.....##..##.#...####.##..##.#...##....##..##.##.##.#..##.",
      "##..##.#......###.##.##..#.##.##.....##..##....#...##....##.#...#.",
      "##..##.#......#.#.##.##.##.##.####...######....#####....##..#####.",
      "#####..#####..#.####..#.##.##...####.##..##....##..##..###..#...##",
      "##.....##.....#..###..###..##.....##.#...##....#...##..##...#...##",
      "##.....##.....#..###..###..##.##..##.#...##....##..##.##....#...##",
      "##.....######.#..###...##..##..####..#...##....#####..#####.#####."] },
    { bold: true, rows: [ // 2 × 4: "Client:" line
      "#####..#####.##...#.##...####..####..#...##....#####..####.######.",
      "##.##..#.....###..#.##...#.##.##.##..#...##....#..##..####.##..##.",
      "#...##.#.....###..#..#..##.##.##.....#...##....#...#.....#.##..##.",
      "#...##.#.....####.#..##.##.##.####...######....#####....##.######.",
      "#####..#####.##.#.#..##.#..##...###..#...##....#...##..##..##..##.",
      "##.....#.....##.###...###..##.....##.#...##....#...##.##...##...##",
      "#......#.....##..##...###..##.##.##..#...##....#...##.##...##..##.",
      "#......#####.##..##...##...##.#####..#...##....#####.############."] },
  ],
};

/** Up to this share of a pattern's pixels may differ (anti-aliasing, a pixel's shift). Other words differ far more. */
const TOLERANCE = 0.08;
const DARK = 160;

export type BrandHit = { x: number; y: number; w: number; h: number; bold: boolean };

/** Where the account name sits in a label image (pixels, top-left origin). Overlapping finds are merged. */
export function findBrandInImage(provider: string, rgba: Uint8Array, width: number, height: number): BrandHit[] {
  const patterns = PATTERNS[provider];
  if (!patterns?.length) return [];
  const dark = new Uint8Array(width * height);
  for (let p = 0; p < dark.length; p++) {
    const a = rgba[p * 4 + 3] / 255;
    const g = (rgba[p * 4] * 0.299 + rgba[p * 4 + 1] * 0.587 + rgba[p * 4 + 2] * 0.114) * a + 255 * (1 - a);
    dark[p] = g < DARK ? 1 : 0;
  }
  const hits: BrandHit[] = [];
  for (const pat of patterns) {
    const h = pat.rows.length, w = pat.rows[0].length;
    const bits = new Uint8Array(w * h);
    pat.rows.forEach((r, y) => { for (let x = 0; x < w; x++) bits[y * w + x] = r[x] === "#" ? 1 : 0; });
    const budget = Math.floor(w * h * TOLERANCE);
    for (let y = 0; y + h <= height; y++) {
      for (let x = 0; x + w <= width; x++) {
        let miss = 0;
        for (let k = 0; k < bits.length && miss <= budget; k++) {
          const ty = (k / w) | 0;
          if (dark[(y + ty) * width + x + k - ty * w] !== bits[k]) miss++;
        }
        if (miss > budget) continue;
        const near = hits.find((o) => x < o.x + o.w && o.x < x + w && y < o.y + o.h && o.y < y + h);
        if (near) { const x1 = Math.max(near.x + near.w, x + w), y1 = Math.max(near.y + near.h, y + h); near.x = Math.min(near.x, x); near.y = Math.min(near.y, y); near.w = x1 - near.x; near.h = y1 - near.y; }
        else hits.push({ x, y, w, h, bold: pat.bold });
      }
    }
  }
  return hits;
}

/** Decodes a PNG to RGBA pixels (first frame). */
export function decodePng(bytes: Uint8Array): { width: number; height: number; rgba: Uint8Array } {
  const img = UPNG.decode(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  return { width: img.width, height: img.height, rgba: new Uint8Array(UPNG.toRGBA8(img)[0]) };
}
