/** Code 128-B barcode → SVG. Supports printable ASCII 32–126 (AWBs, LRs, order ids). */
const PATTERNS = [
  "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213","221312","231212","112232","122132","122231","113222","123122","123221","223211","221132","221231","213212","223112","312131","311222","321122","321221","312212","322112","322211","212123","212321","232121","111323","131123","131321","112313","132113","132311","211313","231113","231311","112133","112331","132131","113123","113321","133121","313121","211331","231131","213113","213311","213131","311123","311321","331121","312113","312311","332111","314111","221411","431111","111224","111422","121124","121421","141122","141221","112214","112412","122114","122411","142112","142211","241211","221114","413111","241112","134111","111242","121142","121241","114212","124112","124211","411212","421112","421211","212141","214121","412121","111143","111341","131141","114113","114311","411113","411311","113141","114131","311141","411131","211412","211214","211232","2331112",
];

export function code128Svg(text: string, opts: { height?: number; module?: number } = {}): string {
  const h = opts.height ?? 60, m = opts.module ?? 2;
  const codes = [104];
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (c < 32 || c > 126) throw new Error("Code128-B supports printable ASCII only");
    codes.push(c - 32);
  }
  const checksum = codes.reduce((s, c, i) => s + c * (i === 0 ? 1 : i), 0) % 103;
  codes.push(checksum, 106);
  let x = 10 * m; // quiet zone
  const bars: string[] = [];
  for (const c of codes) {
    const p = PATTERNS[c];
    for (let i = 0; i < p.length; i++) {
      const w = Number(p[i]) * m;
      if (i % 2 === 0) bars.push(`<rect x="${x}" y="0" width="${w}" height="${h}"/>`);
      x += w;
    }
  }
  const width = x + 10 * m;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${h}" preserveAspectRatio="none" role="img" aria-label="Barcode ${text}"><rect width="${width}" height="${h}" fill="#fff"/><g fill="#000">${bars.join("")}</g></svg>`;
}

/**
 * Code 128-B as bar runs in module units: { bars: [startModule, widthModules][], modules } where
 * `modules` includes a 10-module quiet zone on each side. Used to draw barcodes into PDFs.
 */
export function code128Bars(text: string): { bars: Array<[number, number]>; modules: number } {
  const codes = [104];
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (c < 32 || c > 126) throw new Error("Code128-B supports printable ASCII only");
    codes.push(c - 32);
  }
  codes.push(codes.reduce((s, c, i) => s + c * (i === 0 ? 1 : i), 0) % 103, 106);
  let x = 10;
  const bars: Array<[number, number]> = [];
  for (const c of codes) {
    const p = PATTERNS[c];
    for (let i = 0; i < p.length; i++) { const w = Number(p[i]); if (i % 2 === 0) bars.push([x, w]); x += w; }
  }
  return { bars, modules: x + 10 };
}
